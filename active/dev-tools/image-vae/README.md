# image-vae — Extreme Image Compression with VAEs

**Compress any image to roughly 1 kilobyte** using a Variational Autoencoder.

This is **extremely lossy** by design. The goal is the smallest possible file
size while preserving enough structure that the image is still recognizable.

## How It Works

1. **Train** a VAE on a dataset of images.
2. **Encode** any image into a small latent vector (default: 1000 floats).
3. **Quantize** the latent vector to 8-bit integers using **per-vector adaptive bounds** — each image gets its own quantization range, fully utilizing the 8-bit precision. This reduces quantization error by ~79% vs. fixed global bounds.
4. **Store** the quantized latent + a minimal header (28 bytes) in a custom `.vae` binary file.
5. **Decode** with the same VAE decoder to reconstruct the image.

The decoder weights are fixed — only ~1 KB is stored per compressed image.

| File             | Size      | Notes                        |
|------------------|-----------|------------------------------|
| 1000×667 RGB PNG | ~1.9 MB   | Original photo               |
| JPEG quality 90  | ~300 KB   | Standard JPEG                 |
| **VAE (ours)**   | **~1 KB** | Extremely lossy, recognizable |

## Quick Start

### Setup

```bash
# Nix (recommended on NixOS)
nix-shell shell.nix

# Or with pip in a venv
python3 -m venv .venv
source .venv/bin/activate
pip install torch torchvision numpy Pillow
```

### Train a model

```bash
# Quick demo on CIFAR-10 (32×32 images, trains in minutes on CPU)
python -m image_vae.cli train --latent-dim 1000 --img-size 32 --epochs 10

# Or on your own image collection
python -m image_vae.cli train \
    --latent-dim 1000 \
    --img-size 128 \
    --epochs 100 \
    --data-dir /path/to/images \
    --model-dir ./checkpoints
```

### Compress & decompress

```bash
# Compress
python -m image_vae.cli compress checkpoints/vae_final.pt photo.jpg photo.vae

# Decompress
python -m image_vae.cli decompress checkpoints/vae_final.pt photo.vae photo_recon.png

# Inspect a compressed file
python -m image_vae.cli info photo.vae

# Sample random images from the learned prior
python -m image_vae.cli sample checkpoints/vae_final.pt --num 9 --output samples.png
```

### One-liner with verify

```bash
python -m image_vae.cli compress model.pt input.jpg output.vae --verify
```

## Architecture

```
Encoder:  3×H×W → Conv layers(stride 2) → 4×4 spatial → Flatten → MLP → mu, logvar
Decoder:  latent → MLP → Reshape 4×4 → ConvTranspose layers(stride 2) → 3×H×W
```

- **Latent dimension**: 1000 (configurable) → ~1 KB with 8-bit quantization
- **Training resolution**: 128×128 default (configurable)
- **Quantization**: Per-vector adaptive 8-bit (uses actual min/max of latent, ~79% less quantization error vs fixed bounds)
- **Parameters**: ~30M for 128×128 model
- **Loss**: VAE (BCE reconstruction + KL divergence)

## Custom Binary Format (`.vae`)

| Offset | Size | Field                |
|--------|------|----------------------|
| 0      | 4    | Magic `vae1`         |
| 4      | 4    | Original width        |
| 8      | 4    | Original height       |
| 12     | 4    | Latent dimension      |
| 16     | 4    | Quantization min (f32)|
| 20     | 4    | Quantization max (f32)|
| 24     | 4    | Reserved/Flags        |
| 28     | N    | Quantized latent (N bytes) |

Total: **28 + latent_dim bytes** (~1028 bytes for latent_dim=1000).

## Limitations

- **Extremely lossy**: fine details, text, and faces are heavily distorted.
- **Decoder-dependent**: you need the same model checkpoint to decompress.
- **Training data matters**: the VAE works best on images similar to its training set.
- **No progressive encoding**: not suitable for streaming.

## Future Ideas

- [ ] Add a pre-trained model download for out-of-the-box use
- [ ] Entropy coding (Huffman / arithmetic coding) for extra ~10–20% savings
- [ ] Per-dimension quantization bounds (adaptive per latent dimension)
- [ ] Vector quantization (VQ-VAE) for sharper reconstructions
- [ ] Different latent sizes per image complexity (variable bitrate)
- [ ] Multi-scale latents (hierarchical VAE) for better detail preservation
