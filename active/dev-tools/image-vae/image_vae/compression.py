"""
Compression / decompression operations for the image VAE.

Binary file format (~1 KB per compressed image):
  [0:4]   Magic bytes "vae1"
  [4:8]   Original width  (uint32, little-endian)
  [8:12]  Original height (uint32, little-endian)
  [12:16] Latent dimension (uint32, little-endian)
  [16:20] Quantization bounds: q_min (float32, little-endian)
  [20:24] Quantization bounds: q_max (float32, little-endian)
  [24:28] Reserved / flags (uint32)
  [28:]   Quantized latent vector (latent_dim bytes, uint8)

Total header: 28 bytes. With latent_dim=1000: 1028 bytes total (~1 KB).
"""

from __future__ import annotations

import struct
import torch
from PIL import Image
from pathlib import Path
from typing import Optional

from .model import VAE
from .entropy import read_huffman_payload, decompress_with_huffman, compress_with_huffman


# Flag bits for the flags field in the header
FLAG_ENTROPY_CODED = 1 << 0

IMAGE_VAE_MAGIC = b"vae1"
HEADER_FORMAT = "<4sIIIffI"  # magic(4s), w(I), h(I), latent_dim(I), q_min(f), q_max(f), flags(I)
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)  # 28 bytes


# ---------------------------------------------------------------------------
# Quantization helpers
# ---------------------------------------------------------------------------

def _compute_quant_bounds(
    z: torch.Tensor,
    q_min: float | None = None,
    q_max: float | None = None,
) -> tuple[float, float]:
    """
    Compute quantization bounds for a latent vector.

    If both q_min and q_max are provided, use them as fixed bounds.
    Otherwise, compute per-vector adaptive bounds (uses the full 8-bit range).
    """
    if q_min is not None and q_max is not None:
        return q_min, q_max
    # Adaptive: use actual min/max of this latent vector
    # Add a small epsilon to avoid division by zero when all values are equal
    actual_min = z.min().item()
    actual_max = z.max().item()
    if actual_max - actual_min < 1e-8:
        # Degenerate case: all values are (almost) the same
        actual_min -= 0.5
        actual_max += 0.5
    return actual_min, actual_max


def quantize_latent(
    z: torch.Tensor,
    q_min: float | None = None,
    q_max: float | None = None,
) -> tuple[torch.Tensor, float, float]:
    """
    Quantize a float latent vector to 8-bit unsigned integers.

    If q_min/q_max are None, adapts bounds per-vector (uses full 8-bit range).

    Returns (quantized_bytes, actual_q_min, actual_q_max).
    """
    q_min, q_max = _compute_quant_bounds(z, q_min, q_max)
    z_clamped = z.clamp(q_min, q_max)
    z_scaled = (z_clamped - q_min) / (q_max - q_min)  # [0, 1]
    z_quant = (z_scaled * 255).round().byte()
    return z_quant, q_min, q_max


def dequantize_latent(
    z_quant: torch.Tensor,
    q_min: float,
    q_max: float,
) -> torch.Tensor:
    """Dequantize an 8-bit latent back to float."""
    z_float = z_quant.float() / 255.0  # [0, 1]
    z = z_float * (q_max - q_min) + q_min
    return z


# ---------------------------------------------------------------------------
# Compression
# ---------------------------------------------------------------------------

def _pack_latent(
    z_quant: torch.Tensor,
    entropy: bool = False,
) -> tuple[bytes, int]:
    """
    Pack quantized latent bytes into the payload format.

    Args:
        z_quant: 8-bit quantized latent tensor [1, latent_dim].
        entropy: If True, Huffman-encode the latent bytes (may not always save space).

    Returns:
        (payload_bytes, flags) where payload is ready to append after the header.
    """
    raw = bytes(z_quant.numpy())
    if entropy:
        packed = compress_with_huffman(raw)
        # Only use entropy coding if it actually saves space
        if len(packed) < len(raw):
            return packed, FLAG_ENTROPY_CODED
    return raw, 0


def compress_image(
    model: VAE,
    image_path: str | Path,
    output_path: Optional[str | Path] = None,
    q_min: float | None = None,
    q_max: float | None = None,
    target_size: Optional[int] = None,
    entropy: bool = False,
) -> bytes:
    """
    Compress an image to the binary VAE format.

    Args:
        model: Trained VAE model (in eval mode).
        image_path: Path to input image.
        output_path: Optional path to write compressed file.
        q_min, q_max: Quantization bounds (None = adaptive per-vector).
        target_size: The image size the model was trained on (defaults to model.img_size).
        entropy: If True, apply Huffman entropy coding when it saves space.

    Returns:
        The compressed bytes.
    """
    if target_size is None:
        target_size = model.img_size

    # Load and preprocess image
    img = Image.open(image_path).convert("RGB")
    orig_w, orig_h = img.size

    # Resize to model's training size
    img_resized = img.resize((target_size, target_size), Image.LANCZOS)

    # Convert to tensor [0, 1]
    img_tensor = torch.tensor(
        bytearray(img_resized.tobytes()), dtype=torch.float32
    ).reshape(1, target_size, target_size, 3).permute(0, 3, 1, 2) / 255.0

    # Encode
    device = next(model.parameters()).device
    img_tensor = img_tensor.to(device)
    with torch.no_grad():
        mu = model.encode_deterministic(img_tensor)

    # Quantize (uses per-vector adaptive bounds when q_min/q_max are None)
    z_quant, actual_q_min, actual_q_max = quantize_latent(mu.cpu(), q_min, q_max)

    # Pack latent bytes (with optional Huffman coding)
    latent_payload, flags = _pack_latent(z_quant, entropy=entropy)

    latent_dim = model.latent_dim
    header = struct.pack(
        HEADER_FORMAT,
        IMAGE_VAE_MAGIC,
        orig_w, orig_h,
        latent_dim,
        actual_q_min, actual_q_max,
        flags,
    )
    payload = header + latent_payload

    if output_path is not None:
        Path(output_path).write_bytes(payload)

    return payload


def compress_image_pil(
    model: VAE,
    pil_image: Image.Image,
    q_min: float | None = None,
    q_max: float | None = None,
    target_size: Optional[int] = None,
    entropy: bool = False,
) -> bytes:
    """Compress a PIL Image directly (for in-memory usage)."""
    if target_size is None:
        target_size = model.img_size
    orig_w, orig_h = pil_image.size
    img_resized = pil_image.resize((target_size, target_size), Image.LANCZOS)

    img_tensor = torch.tensor(
        bytearray(img_resized.tobytes()), dtype=torch.float32
    ).reshape(1, target_size, target_size, 3).permute(0, 3, 1, 2) / 255.0

    device = next(model.parameters()).device
    img_tensor = img_tensor.to(device)
    with torch.no_grad():
        mu = model.encode_deterministic(img_tensor)

    z_quant, actual_q_min, actual_q_max = quantize_latent(mu.cpu(), q_min, q_max)
    latent_payload, flags = _pack_latent(z_quant, entropy=entropy)

    header = struct.pack(
        HEADER_FORMAT,
        IMAGE_VAE_MAGIC,
        orig_w, orig_h,
        model.latent_dim,
        actual_q_min, actual_q_max,
        flags,
    )
    return header + latent_payload


# ---------------------------------------------------------------------------
# Decompression
# ---------------------------------------------------------------------------

def decompress_image(
    model: VAE,
    compressed_path: str | Path | bytes,
    output_path: Optional[str | Path] = None,
    target_size: Optional[int] = None,
) -> Image.Image:
    """
    Decompress a VAE-compressed image back to a PIL Image.

    Args:
        model: Trained VAE model (in eval mode).
        compressed_path: Path to compressed file, or raw bytes.
        output_path: Optional path to save the resulting image.
        target_size: The image size the model was trained on (defaults to model.img_size).

    Returns:
        PIL Image reconstructed from the latent vector, resized to original dimensions.
    """
    if target_size is None:
        target_size = model.img_size

    # Read input
    if isinstance(compressed_path, (str, Path)):
        data = Path(compressed_path).read_bytes()
    else:
        data = compressed_path

    # Parse header
    header_size = HEADER_SIZE
    header = data[:header_size]
    magic, orig_w, orig_h, latent_dim, q_min, q_max, flags = struct.unpack(HEADER_FORMAT, header)

    assert magic == IMAGE_VAE_MAGIC, f"Invalid magic: {magic!r}"

    # Parse latent data (may be raw or Huffman-coded)
    payload = data[header_size:]
    if flags & FLAG_ENTROPY_CODED:
        # Huffman-coded payload: [table] [compressed data]
        latent_bytes = decompress_with_huffman(payload, latent_dim)
    else:
        latent_bytes = payload
    assert len(latent_bytes) == latent_dim, (
        f"Expected {latent_dim} latent bytes after decompression, got {len(latent_bytes)}"
    )

    z_quant = torch.tensor(list(latent_bytes), dtype=torch.uint8).unsqueeze(0)  # [1, latent_dim]

    # Dequantize
    z = dequantize_latent(z_quant, q_min, q_max)

    # Decode
    device = next(model.parameters()).device
    z = z.to(device)
    with torch.no_grad():
        recon = model.decode(z)  # [1, 3, target_size, target_size]

    # Convert to PIL
    recon_img = recon.squeeze(0).cpu().clamp(0, 1)
    recon_img = recon_img.permute(1, 2, 0).numpy()  # [H, W, 3]
    recon_img = (recon_img * 255).astype("uint8")
    pil_img = Image.fromarray(recon_img, "RGB")

    # Resize back to original dimensions
    if orig_w > 0 and orig_h > 0:
        pil_img = pil_img.resize((orig_w, orig_h), Image.LANCZOS)

    if output_path is not None:
        pil_img.save(output_path)

    return pil_img


# ---------------------------------------------------------------------------
# Compressed image wrapper
# ---------------------------------------------------------------------------

class CompressedImage:
    """Holds compressed image data with metadata for inspection."""

    def __init__(self, data: bytes):
        self.data = data
        header = data[:HEADER_SIZE]
        self.magic, self.orig_w, self.orig_h, self.latent_dim, self.q_min, self.q_max, self.flags = (
            struct.unpack(HEADER_FORMAT, header)
        )
        assert self.magic == IMAGE_VAE_MAGIC, f"Invalid magic: {self.magic!r}"

    @classmethod
    def from_file(cls, path: str | Path) -> "CompressedImage":
        return cls(Path(path).read_bytes())

    @property
    def is_entropy_coded(self) -> bool:
        return bool(self.flags & FLAG_ENTROPY_CODED)

    @property
    def file_size(self) -> int:
        return len(self.data)

    @property
    def latent_bytes(self) -> bytes:
        return self.data[HEADER_SIZE:]

    def __repr__(self) -> str:
        entropy_tag = " [entropy]" if self.is_entropy_coded else ""
        return (
            f"CompressedImage({self.file_size}B{entropy_tag}, "
            f"{self.orig_w}x{self.orig_h}, "
            f"latent_dim={self.latent_dim})"
        )
