"""
HiveMind Coordinator Server

Flask application with WebSocket support for coordinating distributed
browser-based LLM inference.
"""

import os
from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from loguru import logger
from pydantic import BaseModel, ValidationError

from cluster import (
    cluster,
    PeerCapabilities,
    PeerState,
    ClusterStats,
)
from models import MODEL_REGISTRY, ModelConfig


# Configure logging
logger.add(
    "logs/coordinator.log",
    rotation="10 MB",
    retention="7 days",
    level="DEBUG",
)


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


class StateUpdate(BaseModel):
    """Peer state update message."""
    state: str  # PeerState value


class InferenceRequest(BaseModel):
    """Request to start an inference."""
    prompt: str
    max_tokens: int = 256
    temperature: float = 0.7
    top_p: float = 0.9


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


# ==================== WebSocket Events ====================

@socketio.on("connect")
def handle_connect():
    """Handle new WebSocket connection."""
    peer_id = request.sid
    logger.info(f"Peer connecting: {peer_id}")
    emit("welcome", {"peer_id": peer_id})


@socketio.on("disconnect")
def handle_disconnect():
    """Handle WebSocket disconnection."""
    peer_id = request.sid
    logger.info(f"Peer disconnecting: {peer_id}")
    
    removed = cluster.remove_peer(peer_id)
    if removed:
        # Notify other peers of the change
        broadcast_cluster_update()


@socketio.on("report_capabilities")
def handle_capabilities(data):
    """Handle peer capability report."""
    peer_id = request.sid
    
    try:
        caps_data = CapabilitiesReport(**data)
        caps = PeerCapabilities(
            vram_gb=caps_data.vram_gb,
            webgpu_supported=caps_data.webgpu_supported,
            compute_capability=caps_data.compute_capability,
            browser=caps_data.browser,
            estimated_tflops=caps_data.estimated_tflops,
        )
    except ValidationError as e:
        logger.error(f"Invalid capabilities from {peer_id}: {e}")
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
        update = StateUpdate(**data)
        state = PeerState(update.state)
    except (ValidationError, ValueError) as e:
        logger.error(f"Invalid state update from {peer_id}: {e}")
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
    logger.info(f"Broadcasting model change: {model.id if model else 'None'}")
    
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
    
    logger.info(f"Starting HiveMind Coordinator on {host}:{port}")
    socketio.run(app, host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
