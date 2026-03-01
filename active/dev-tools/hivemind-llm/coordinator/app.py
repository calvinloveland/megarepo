"""
HiveMind Coordinator Server

Flask application with WebSocket support for coordinating distributed
browser-based LLM inference.
"""

import logging
import os
from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from pydantic import BaseModel, ValidationError

from cluster import (
    cluster,
    PeerCapabilities,
    PeerState,
)
from models import MODEL_REGISTRY, ModelConfig


# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


# Flask app setup
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "hivemind-dev-secret")
CORS(app, origins="*")

# SocketIO setup
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    logger=True,
    engineio_logger=True,
)


# ==================== Pydantic Models ====================

class CapabilitiesReport(BaseModel):
    """Capabilities reported by a peer on connection."""
    vram_gb: float
    webgpu_supported: bool
    compute_capability: str = "unknown"
    browser: str = "unknown"
    estimated_tflops: float = 0.0

    @classmethod
    def from_payload(cls, payload: dict) -> "CapabilitiesReport":
        """Build a capabilities report from a socket payload."""
        return cls(**payload)

    def to_peer_capabilities(self) -> PeerCapabilities:
        """Convert to cluster peer capability structure."""
        return PeerCapabilities(
            vram_gb=self.vram_gb,
            webgpu_supported=self.webgpu_supported,
            compute_capability=self.compute_capability,
            browser=self.browser,
            estimated_tflops=self.estimated_tflops,
        )


class StateUpdate(BaseModel):
    """Peer state update message."""
    state: str  # PeerState value

    @classmethod
    def from_payload(cls, payload: dict) -> "StateUpdate":
        """Build a state update from a socket payload."""
        return cls(**payload)

    def to_peer_state(self) -> PeerState:
        """Convert to a peer state enum."""
        return PeerState(self.state)


class InferenceRequest(BaseModel):
    """Request to start an inference."""
    prompt: str
    max_tokens: int = 256
    temperature: float = 0.7
    top_p: float = 0.9

    @classmethod
    def from_payload(cls, payload: dict) -> "InferenceRequest":
        """Build an inference request from payload data."""
        return cls(**payload)

    def as_prompt_kwargs(self) -> dict:
        """Return request data as keyword arguments for inference calls."""
        return {
            "prompt": self.prompt,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "top_p": self.top_p,
        }


# ==================== REST Endpoints ====================

@app.route("/")
def index():
    """Health check and basic info."""
    stats = cluster.get_stats()
    return jsonify({
        "service": "HiveMind Coordinator",
        "status": "ok",
        "cluster": {
            "peers": stats.total_peers,
            "ready_peers": stats.ready_peers,
            "total_vram_gb": round(stats.total_vram_gb, 2),
            "active_model": stats.active_model.name if stats.active_model else None,
        }
    })


@app.route("/api/models")
def list_models():
    """List all supported models."""
    return jsonify({
        "models": [
            {
                "id": m.id,
                "name": m.name,
                "layers": m.num_layers,
                "vram_required_gb": m.vram_required_gb,
                "min_peers": m.min_peers,
                "tier": m.tier.name,
            }
            for m in MODEL_REGISTRY
        ]
    })


@app.route("/api/cluster/stats")
def cluster_stats():
    """Get detailed cluster statistics."""
    stats = cluster.get_stats()
    peers = cluster.get_all_peers()

    return jsonify({
        "total_peers": stats.total_peers,
        "ready_peers": stats.ready_peers,
        "total_vram_gb": round(stats.total_vram_gb, 2),
        "active_model": {
            "id": stats.active_model.id,
            "name": stats.active_model.name,
            "layers": stats.active_model.num_layers,
        } if stats.active_model else None,
        "tokens_generated": stats.tokens_generated,
        "requests_completed": stats.requests_completed,
        "peers": [
            {
                "id": pid,
                "state": p.state.value,
                "vram_gb": round(p.capabilities.vram_gb, 2),
                "layers": p.assigned_layers,
                "browser": p.capabilities.browser,
            }
            for pid, p in peers.items()
        ],
        "pipeline_order": cluster.get_peer_order(),
    })


@app.route("/api/cluster/peers")
def list_peers():
    """List all connected peers."""
    peers = cluster.get_all_peers()
    return jsonify({
        "peers": [
            {
                "id": pid,
                "state": p.state.value,
                "vram_gb": round(p.capabilities.vram_gb, 2),
                "layers": p.assigned_layers,
            }
            for pid, p in peers.items()
        ]
    })


@app.route("/api/errors", methods=["POST"])
def receive_errors():
    """Receive error reports from browser clients."""
    try:
        data = request.get_json()
        errors = data.get("errors", [])

        for error in errors:
            location = (
                f"{error.get('filename', 'N/A')}:"
                f"{error.get('lineno', '?')}:"
                f"{error.get('colno', '?')}"
            )
            logger.error(
                "[BROWSER ERROR] %s: %s\n  URL: %s\n  File: %s\n  Source: %s\n  Stack: %s",
                error.get("type", "Error"),
                error.get("message", "Unknown"),
                error.get("url", "N/A"),
                location,
                error.get("source", "unknown"),
                error.get("stack", "N/A"),
            )

        return jsonify({"received": len(errors)}), 200
    except (TypeError, ValueError, AttributeError) as error:
        logger.exception("Failed to process error report")
        return jsonify({"error": str(error)}), 500


# ==================== WebSocket Events ====================

@socketio.on("connect")
def handle_connect():
    """Handle new WebSocket connection."""
    peer_id = request.sid
    logger.info("Peer connecting: %s", peer_id)
    emit("welcome", {"peer_id": peer_id})


@socketio.on("disconnect")
def handle_disconnect():
    """Handle WebSocket disconnection."""
    peer_id = request.sid
    logger.info("Peer disconnecting: %s", peer_id)

    removed = cluster.remove_peer(peer_id)
    if removed:
        # Notify other peers of the change
        broadcast_cluster_update()


@socketio.on("report_capabilities")
def handle_capabilities(data):
    """Handle peer capability report."""
    peer_id = request.sid

    try:
        caps_data = CapabilitiesReport.from_payload(data)
        caps = caps_data.to_peer_capabilities()
    except ValidationError as e:
        logger.error("Invalid capabilities from %s: %s", peer_id, e)
        emit("error", {"message": "Invalid capabilities format"})
        return

    # Add peer to cluster
    assignment = cluster.add_peer(peer_id, caps)

    if assignment is None:
        emit("error", {"message": "Cannot join cluster: insufficient capabilities"})
        return

    # Send assignment to peer
    emit("layer_assignment", {
        "model": {
            "id": assignment.model.id,
            "name": assignment.model.name,
            "mlc_model_id": assignment.model.mlc_model_id,
            "num_layers": assignment.model.num_layers,
            "hidden_size": assignment.model.hidden_size,
            "quantization": assignment.model.quantization,
        },
        "start_layer": assignment.start_layer,
        "end_layer": assignment.end_layer,
        "is_first": assignment.is_first,
        "is_last": assignment.is_last,
        "peer_order": assignment.peer_order,
    })

    # Join the coordination room
    join_room("cluster")

    # Notify other peers
    broadcast_cluster_update()


@socketio.on("state_update")
def handle_state_update(data):
    """Handle peer state update."""
    peer_id = request.sid

    try:
        update = StateUpdate.from_payload(data)
        state = update.to_peer_state()
    except (ValidationError, ValueError) as e:
        logger.error("Invalid state update from %s: %s", peer_id, e)
        return

    cluster.update_peer_state(peer_id, state)

    # Broadcast if peer became ready
    if state == PeerState.READY:
        broadcast_cluster_update()


@socketio.on("heartbeat")
def handle_heartbeat():
    """Handle peer heartbeat."""
    peer_id = request.sid
    cluster.peer_heartbeat(peer_id)
    emit("heartbeat_ack", {"timestamp": "ok"})


@socketio.on("webrtc_signal")
def handle_webrtc_signal(data):
    """Relay WebRTC signaling messages between peers."""
    from_peer = request.sid
    to_peer = data.get("target_peer")
    signal_data = data.get("signal")

    if not to_peer or not signal_data:
        return

    # Relay to target peer
    emit(
        "webrtc_signal",
        {
            "from_peer": from_peer,
            "signal": signal_data,
        },
        room=to_peer,
    )


@socketio.on("inference_complete")
def handle_inference_complete(data):
    """Handle notification that inference is complete."""
    tokens = data.get("tokens_generated", 0)
    cluster.record_generation(tokens)
    cluster.record_request_complete()


def broadcast_cluster_update():
    """Broadcast cluster state update to all peers."""
    stats = cluster.get_stats()

    socketio.emit(
        "cluster_update",
        {
            "total_peers": stats.total_peers,
            "ready_peers": stats.ready_peers,
            "total_vram_gb": round(stats.total_vram_gb, 2),
            "active_model": stats.active_model.id if stats.active_model else None,
            "pipeline_order": cluster.get_peer_order(),
        },
        room="cluster",
    )


# ==================== Model Change Handler ====================

def on_model_change(model: ModelConfig | None):
    """Handle model change event."""
    logger.info("Broadcasting model change: %s", model.id if model else "None")

    # Notify all peers they need to reload
    if model:
        socketio.emit(
            "model_change",
            {
                "model": {
                    "id": model.id,
                    "name": model.name,
                    "mlc_model_id": model.mlc_model_id,
                    "num_layers": model.num_layers,
                },
                "action": "reload_layers",
            },
            room="cluster",
        )


cluster.on_model_change(on_model_change)


# ==================== Main ====================

def main():
    """Run the coordinator server."""
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("DEBUG", "true").lower() == "true"

    logger.info("Starting HiveMind Coordinator on %s:%s", host, port)
    socketio.run(app, host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
