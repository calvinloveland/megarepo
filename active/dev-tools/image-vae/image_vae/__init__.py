"""
image_vae — Variational Autoencoder for extreme image compression (~1KB per image).

Compresses any image to roughly 1 kilobyte by encoding into a small latent space,
quantizing to 8-bit integers, and storing in a custom binary format.
The decoder model is loaded at decompression time — only the latent vector
plus minimal metadata is stored per image.
"""

from .model import VAE, Encoder, Decoder, vae_loss
from .compression import compress_image, decompress_image, CompressedImage, IMAGE_VAE_MAGIC, FLAG_ENTROPY_CODED
from .train import Trainer, train_vae
from .entropy import (
    HuffmanEncoder, HuffmanDecoder,
    compress_with_huffman, decompress_with_huffman,
    entropy_savings,
)

__version__ = "0.1.0"
