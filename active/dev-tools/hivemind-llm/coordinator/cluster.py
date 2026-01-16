"""
Cluster state management for HiveMind coordinator.

Tracks connected peers, their capabilities, and manages the distributed
model layer assignments.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable
import threading
from loguru import logger

from models import (
    ModelConfig,
    get_best_model_for_capacity,
    calculate_layer_distribution,
    MODEL_REGISTRY,
)


class PeerState(Enum):
    """Connection states for a peer."""
    CONNECTING = "connecting"      # Initial connection, reporting capabilities
    DOWNLOADING = "downloading"    # Downloading assigned model layers
    READY = "ready"               # Ready to participate in inference
    BUSY = "busy"                 # Currently processing an inference request
    DISCONNECTING = "disconnecting"  # Gracefully leaving


@dataclass
class PeerCapabilities:
    """Hardware and software capabilities of a peer."""
    vram_gb: float                 # Available GPU VRAM in GB
    webgpu_supported: bool         # Whether WebGPU is available
    compute_capability: str        # GPU compute capability string
    browser: str                   # Browser name and version
    estimated_tflops: float = 0.0  # Estimated compute performance


@dataclass
class PeerInfo:
    """Information about a connected peer."""
    peer_id: str
    capabilities: PeerCapabilities
    state: PeerState
    assigned_layers: tuple[int, int] | None = None  # (start, end) inclusive
    connected_at: datetime = field(default_factory=datetime.utcnow)
    last_heartbeat: datetime = field(default_factory=datetime.utcnow)
    current_model_id: str | None = None


@dataclass
class LayerAssignment:
    """Layer assignment for a peer after joining."""
    model: ModelConfig
    start_layer: int
    end_layer: int
    is_first: bool      # Handles embedding
    is_last: bool       # Handles LM head and output
    peer_order: list[str]  # Order of peers in the pipeline


@dataclass
class ClusterStats:
    """Current cluster statistics."""
    total_peers: int
    ready_peers: int
    total_vram_gb: float
    active_model: ModelConfig | None
    tokens_generated: int = 0
    requests_completed: int = 0


class ClusterState:
    """
    Thread-safe cluster state manager.
    
    Maintains the state of all connected peers, handles model selection
    based on available capacity, and manages layer assignments.
    """
    
    def __init__(self):
        self._lock = threading.RLock()
        self._peers: dict[str, PeerInfo] = {}
        self._active_model: ModelConfig | None = None
        self._layer_assignments: dict[str, tuple[int, int]] = {}
        self._peer_order: list[str] = []  # Pipeline order
        
        # Callbacks for state changes
        self._on_model_change: list[Callable[[ModelConfig | None], None]] = []
        self._on_peer_change: list[Callable[[str, PeerState], None]] = []
        
        # Stats
        self._tokens_generated = 0
        self._requests_completed = 0
    
    def add_peer(
        self,
        peer_id: str,
        capabilities: PeerCapabilities
    ) -> LayerAssignment | None:
        """
        Add a new peer to the cluster.
        
        Returns the layer assignment for the new peer, or None if the peer
        cannot be added (e.g., insufficient capabilities).
        """
        with self._lock:
            if peer_id in self._peers:
                logger.warning(f"Peer {peer_id} already exists, updating capabilities")
                self._peers[peer_id].capabilities = capabilities
                return self._get_assignment_for_peer(peer_id)
            
            # Validate capabilities
            if not capabilities.webgpu_supported:
                logger.warning(f"Peer {peer_id} does not support WebGPU")
                return None
            
            if capabilities.vram_gb < 0.2:
                logger.warning(f"Peer {peer_id} has insufficient VRAM: {capabilities.vram_gb}GB")
                return None
            
            # Add the peer
            peer = PeerInfo(
                peer_id=peer_id,
                capabilities=capabilities,
                state=PeerState.CONNECTING,
            )
            self._peers[peer_id] = peer
            
            logger.info(f"Peer {peer_id} joined with {capabilities.vram_gb}GB VRAM")
            
            # Recalculate model and assignments
            self._recalculate_cluster()
            
            return self._get_assignment_for_peer(peer_id)
    
    def remove_peer(self, peer_id: str) -> bool:
        """
        Remove a peer from the cluster.
        
        Returns True if the peer was removed, False if it wasn't found.
        """
        with self._lock:
            if peer_id not in self._peers:
                return False
            
            logger.info(f"Peer {peer_id} leaving cluster")
            del self._peers[peer_id]
            
            # Recalculate model and assignments
            self._recalculate_cluster()
            
            return True
    
    def update_peer_state(self, peer_id: str, state: PeerState) -> bool:
        """Update the state of a peer."""
        with self._lock:
            if peer_id not in self._peers:
                return False
            
            old_state = self._peers[peer_id].state
            self._peers[peer_id].state = state
            self._peers[peer_id].last_heartbeat = datetime.utcnow()
            
            logger.debug(f"Peer {peer_id} state: {old_state.value} -> {state.value}")
            
            for callback in self._on_peer_change:
                try:
                    callback(peer_id, state)
                except Exception as e:
                    logger.error(f"Error in peer change callback: {e}")
            
            return True
    
    def peer_heartbeat(self, peer_id: str) -> bool:
        """Update the last heartbeat time for a peer."""
        with self._lock:
            if peer_id not in self._peers:
                return False
            self._peers[peer_id].last_heartbeat = datetime.utcnow()
            return True
    
    def get_peer(self, peer_id: str) -> PeerInfo | None:
        """Get information about a specific peer."""
        with self._lock:
            return self._peers.get(peer_id)
    
    def get_all_peers(self) -> dict[str, PeerInfo]:
        """Get a copy of all peer information."""
        with self._lock:
            return dict(self._peers)
    
    def get_ready_peers(self) -> list[str]:
        """Get list of peer IDs that are ready for inference."""
        with self._lock:
            return [
                peer_id for peer_id, peer in self._peers.items()
                if peer.state == PeerState.READY
            ]
    
    def get_active_model(self) -> ModelConfig | None:
        """Get the currently active model."""
        with self._lock:
            return self._active_model
    
    def get_peer_order(self) -> list[str]:
        """Get the order of peers in the inference pipeline."""
        with self._lock:
            return list(self._peer_order)
    
    def get_stats(self) -> ClusterStats:
        """Get current cluster statistics."""
        with self._lock:
            total_vram = sum(p.capabilities.vram_gb for p in self._peers.values())
            ready_peers = len(self.get_ready_peers())
            
            return ClusterStats(
                total_peers=len(self._peers),
                ready_peers=ready_peers,
                total_vram_gb=total_vram,
                active_model=self._active_model,
                tokens_generated=self._tokens_generated,
                requests_completed=self._requests_completed,
            )
    
    def record_generation(self, tokens: int) -> None:
        """Record tokens generated for stats."""
        with self._lock:
            self._tokens_generated += tokens
    
    def record_request_complete(self) -> None:
        """Record a completed request for stats."""
        with self._lock:
            self._requests_completed += 1
    
    def on_model_change(self, callback: Callable[[ModelConfig | None], None]) -> None:
        """Register a callback for model changes."""
        self._on_model_change.append(callback)
    
    def on_peer_change(self, callback: Callable[[str, PeerState], None]) -> None:
        """Register a callback for peer state changes."""
        self._on_peer_change.append(callback)
    
    def _recalculate_cluster(self) -> None:
        """
        Recalculate the active model and layer assignments based on current peers.
        
        Must be called with lock held.
        """
        if not self._peers:
            self._active_model = None
            self._layer_assignments = {}
            self._peer_order = []
            self._notify_model_change(None)
            return
        
        # Calculate total capacity
        total_vram = sum(p.capabilities.vram_gb for p in self._peers.values())
        num_peers = len(self._peers)
        
        # Select the best model
        new_model = get_best_model_for_capacity(total_vram, num_peers)
        model_changed = self._active_model is None or self._active_model.id != new_model.id
        
        if model_changed:
            logger.info(
                f"Model change: {self._active_model.id if self._active_model else 'None'} "
                f"-> {new_model.id} (VRAM: {total_vram:.1f}GB, peers: {num_peers})"
            )
        
        self._active_model = new_model
        
        # Calculate layer distribution
        peer_vrams = {
            peer_id: peer.capabilities.vram_gb
            for peer_id, peer in self._peers.items()
        }
        
        self._layer_assignments = calculate_layer_distribution(new_model, peer_vrams)
        
        # Determine peer order (by layer assignment)
        self._peer_order = sorted(
            self._layer_assignments.keys(),
            key=lambda pid: self._layer_assignments[pid][0]
        )
        
        # Update peer info with assignments
        for peer_id, (start, end) in self._layer_assignments.items():
            self._peers[peer_id].assigned_layers = (start, end)
            self._peers[peer_id].current_model_id = new_model.id
        
        if model_changed:
            self._notify_model_change(new_model)
    
    def _notify_model_change(self, model: ModelConfig | None) -> None:
        """Notify callbacks of model change."""
        for callback in self._on_model_change:
            try:
                callback(model)
            except Exception as e:
                logger.error(f"Error in model change callback: {e}")
    
    def _get_assignment_for_peer(self, peer_id: str) -> LayerAssignment | None:
        """Get the layer assignment for a specific peer."""
        if not self._active_model or peer_id not in self._layer_assignments:
            return None
        
        start, end = self._layer_assignments[peer_id]
        
        return LayerAssignment(
            model=self._active_model,
            start_layer=start,
            end_layer=end,
            is_first=(start == 0),
            is_last=(end == self._active_model.num_layers - 1),
            peer_order=self._peer_order,
        )


# Global cluster state instance
cluster = ClusterState()
