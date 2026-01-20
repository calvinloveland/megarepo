"""
Model registry and tier selection logic for HiveMind.

Models are organized in tiers based on VRAM requirements.
The coordinator selects the best model based on total cluster capacity.
"""

from dataclasses import dataclass
from enum import Enum


class ModelTier(Enum):
    """Model capability tiers based on cluster VRAM."""
    TINY = 1      # < 2GB total
    SMALL = 2     # 2-4GB total
    MEDIUM = 3    # 4-8GB total
    LARGE = 4     # 8-16GB total
    XLARGE = 5    # 16GB+ total


@dataclass
class ModelConfig:
    """Configuration for a supported model."""
    id: str                    # Unique identifier
    name: str                  # Display name
    hf_repo: str              # HuggingFace repository
    mlc_model_id: str         # MLC-compiled model identifier for WebLLM
    num_layers: int           # Number of transformer layers
    hidden_size: int          # Hidden dimension size
    vocab_size: int           # Vocabulary size
    vram_required_gb: float   # Total VRAM needed (quantized)
    min_peers: int            # Minimum peers for distributed mode
    tier: ModelTier           # Capability tier
    quantization: str         # Quantization level (e.g., "q4f16_1")


# Model registry - ordered by size (smallest to largest)
MODEL_REGISTRY: list[ModelConfig] = [
    ModelConfig(
        id="smollm-135m",
        name="SmolLM 135M",
        hf_repo="HuggingFaceTB/SmolLM-135M",
        mlc_model_id="SmolLM-135M-Instruct-q4f16_1-MLC",
        num_layers=12,
        hidden_size=576,
        vocab_size=49152,
        vram_required_gb=0.3,
        min_peers=1,
        tier=ModelTier.TINY,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="tinyllama-1.1b",
        name="TinyLlama 1.1B",
        hf_repo="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        mlc_model_id="TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
        num_layers=22,
        hidden_size=2048,
        vocab_size=32000,
        vram_required_gb=1.5,
        min_peers=1,
        tier=ModelTier.SMALL,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="phi-2",
        name="Phi-2 2.7B",
        hf_repo="microsoft/phi-2",
        mlc_model_id="Phi-2-q4f16_1-MLC",
        num_layers=32,
        hidden_size=2560,
        vocab_size=51200,
        vram_required_gb=3.0,
        min_peers=2,
        tier=ModelTier.MEDIUM,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="llama-3.2-1b",
        name="Llama 3.2 1B",
        hf_repo="meta-llama/Llama-3.2-1B-Instruct",
        mlc_model_id="Llama-3.2-1B-Instruct-q4f16_1-MLC",
        num_layers=16,
        hidden_size=2048,
        vocab_size=128256,
        vram_required_gb=1.2,
        min_peers=1,
        tier=ModelTier.SMALL,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="llama-3.2-3b",
        name="Llama 3.2 3B",
        hf_repo="meta-llama/Llama-3.2-3B-Instruct",
        mlc_model_id="Llama-3.2-3B-Instruct-q4f16_1-MLC",
        num_layers=28,
        hidden_size=3072,
        vocab_size=128256,
        vram_required_gb=3.5,
        min_peers=2,
        tier=ModelTier.MEDIUM,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="mistral-7b",
        name="Mistral 7B Instruct",
        hf_repo="mistralai/Mistral-7B-Instruct-v0.3",
        mlc_model_id="Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
        num_layers=32,
        hidden_size=4096,
        vocab_size=32768,
        vram_required_gb=6.0,
        min_peers=3,
        tier=ModelTier.LARGE,
        quantization="q4f16_1",
    ),
    ModelConfig(
        id="llama-3.1-8b",
        name="Llama 3.1 8B Instruct",
        hf_repo="meta-llama/Meta-Llama-3.1-8B-Instruct",
        mlc_model_id="Llama-3.1-8B-Instruct-q4f16_1-MLC",
        num_layers=32,
        hidden_size=4096,
        vocab_size=128256,
        vram_required_gb=7.0,
        min_peers=3,
        tier=ModelTier.LARGE,
        quantization="q4f16_1",
    ),
]


def get_model_by_id(model_id: str) -> ModelConfig | None:
    """Get a model configuration by its ID."""
    for model in MODEL_REGISTRY:
        if model.id == model_id:
            return model
    return None


def get_best_model_for_capacity(total_vram_gb: float, num_peers: int) -> ModelConfig:
    """
    Select the best (largest) model that can run with the given cluster capacity.
    
    Args:
        total_vram_gb: Total VRAM available across all peers
        num_peers: Number of connected peers
        
    Returns:
        The best model configuration for the available capacity
    """
    # Filter models that fit within our capacity
    viable_models = [
        model for model in MODEL_REGISTRY
        if model.vram_required_gb <= total_vram_gb and model.min_peers <= num_peers
    ]
    
    if not viable_models:
        # Fall back to the smallest model (should always fit)
        return MODEL_REGISTRY[0]
    
    # Return the largest viable model (registry is ordered by size)
    return viable_models[-1]


def calculate_layer_distribution(
    model: ModelConfig,
    peer_vrams: dict[str, float]
) -> dict[str, tuple[int, int]]:
    """
    Distribute model layers across peers based on their available VRAM.
    
    Uses proportional allocation: peers with more VRAM get more layers.
    
    Args:
        model: The model to distribute
        peer_vrams: Dict mapping peer_id -> available VRAM in GB
        
    Returns:
        Dict mapping peer_id -> (start_layer, end_layer) inclusive
    """
    if not peer_vrams:
        return {}
    
    peer_ids = list(peer_vrams.keys())
    total_vram = sum(peer_vrams.values())
    
    # Single peer gets all layers
    if len(peer_ids) == 1:
        return {peer_ids[0]: (0, model.num_layers - 1)}
    
    # Calculate proportional layer counts
    layer_counts: dict[str, int] = {}
    assigned_layers = 0
    
    for peer_id in peer_ids[:-1]:  # All but the last peer
        proportion = peer_vrams[peer_id] / total_vram
        layers = max(1, int(proportion * model.num_layers))
        layer_counts[peer_id] = layers
        assigned_layers += layers
    
    # Last peer gets the remaining layers
    layer_counts[peer_ids[-1]] = model.num_layers - assigned_layers
    
    # Convert counts to ranges
    assignments: dict[str, tuple[int, int]] = {}
    current_layer = 0
    
    for peer_id in peer_ids:
        count = layer_counts[peer_id]
        assignments[peer_id] = (current_layer, current_layer + count - 1)
        current_layer += count
    
    return assignments


def get_vram_per_layer(model: ModelConfig) -> float:
    """Estimate VRAM required per layer for a model."""
    return model.vram_required_gb / model.num_layers
