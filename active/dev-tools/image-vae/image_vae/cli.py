"""
Command-line interface for the image VAE.

Usage:
    # Train (using CIFAR-10 for quick demo, or --data-dir for custom images)
    python -m image_vae.cli train --latent-dim 1000 --img-size 128 --epochs 50

    # Compress an image
    python -m image_vae.cli compress model.pt input.jpg output.vae

    # Decompress
    python -m image_vae.cli decompress model.pt input.vae output.png

    # Inspect a compressed file
    python -m image_vae.cli info input.vae

    # Sample random images from the model
    python -m image_vae.cli sample model.pt --num 4 --output samples.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

from . import VAE
from .compression import compress_image, decompress_image, CompressedImage
from .train import train_vae


def _load_model(model_path: str | Path, device: str = "cpu") -> VAE:
    ckpt = torch.load(model_path, map_location=device, weights_only=False)
    latent_dim = ckpt.get("latent_dim", 1000)
    img_size = ckpt.get("img_size", 128)
    img_channels = ckpt.get("img_channels", 3)
    base_channels = ckpt.get("base_channels", 64)
    max_channels = ckpt.get("max_channels", 512)
    model = VAE(
        latent_dim=latent_dim,
        img_channels=img_channels,
        img_size=img_size,
        base_channels=base_channels,
        max_channels=max_channels,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    model.eval()
    return model


def cmd_train(args: argparse.Namespace):
    print("Starting training...")
    train_vae(
        latent_dim=args.latent_dim,
        img_size=args.img_size,
        img_channels=args.channels,
        base_channels=args.base_channels,
        max_channels=args.max_channels,
        batch_size=args.batch_size,
        num_epochs=args.epochs,
        lr=args.lr,
        beta=args.beta,
        device=args.device,
        model_dir=args.model_dir,
        data_dir=args.data_dir,
        resume=args.resume,
    )


def cmd_compress(args: argparse.Namespace):
    model = _load_model(args.model, args.device)
    print(f"Compressing {args.input} → {args.output} ...")
    data = compress_image(model, args.input, output_path=args.output, entropy=args.entropy)
    size_kb = len(data) / 1024
    ci = CompressedImage(data)
    entropy_tag = " [entropy coded]" if ci.is_entropy_coded else ""
    print(f"Done: {len(data)} bytes ({size_kb:.2f} KB){entropy_tag} | "
          f"orig {ci.orig_w}×{ci.orig_h} | latent_dim={ci.latent_dim}")
    if args.verify:
        print("Verifying by decompressing back...")
        recon = decompress_image(model, data)
        verify_path = Path(args.output).with_suffix(".verify.png")
        recon.save(verify_path)
        print(f"Verification image: {verify_path}")


def cmd_decompress(args: argparse.Namespace):
    model = _load_model(args.model, args.device)
    print(f"Decompressing {args.input} → {args.output} ...")
    img = decompress_image(model, args.input, output_path=args.output)
    print(f"Done: {img.size[0]}×{img.size[1]}")


def cmd_info(args: argparse.Namespace):
    ci = CompressedImage.from_file(args.input)
    entropy_tag = "yes (Huffman)" if ci.is_entropy_coded else "no (raw)"
    print(f"Compressed image info:")
    print(f"  File size:       {ci.file_size} bytes ({ci.file_size/1024:.2f} KB)")
    print(f"  Original size:   {ci.orig_w}×{ci.orig_h}")
    print(f"  Latent dim:      {ci.latent_dim}")
    print(f"  Quantization:    [{ci.q_min:.2f}, {ci.q_max:.2f}]")
    print(f"  Entropy coding:   {entropy_tag}")
    print(f"  Flags:           0x{ci.flags:08x}")


def cmd_sample(args: argparse.Namespace):
    model = _load_model(args.model, args.device)
    print(f"Sampling {args.num} images from prior...")
    samples = model.sample(args.num, device=args.device)
    # Save as a grid
    import math
    from PIL import Image
    n = args.num
    cols = min(n, 4)
    rows = math.ceil(n / cols)
    grid_w = cols * model.img_size
    grid_h = rows * model.img_size
    grid = Image.new("RGB", (grid_w, grid_h))
    for i in range(n):
        img_t = samples[i].cpu().clamp(0, 1).permute(1, 2, 0).numpy()
        img_t = (img_t * 255).astype("uint8")
        pil = Image.fromarray(img_t, "RGB")
        row, col = divmod(i, cols)
        grid.paste(pil, (col * model.img_size, row * model.img_size))
    grid.save(args.output)
    print(f"Samples saved to {args.output}")


def main():
    parser = argparse.ArgumentParser(
        description="image_vae: extreme image compression with VAEs (~1 KB/image)"
    )
    parser.add_argument("--device", default=None, help="cpu or cuda (default: auto-detect)")
    sub = parser.add_subparsers(dest="command", required=True)

    # train
    p_train = sub.add_parser("train", help="Train a new VAE model")
    p_train.add_argument("--latent-dim", type=int, default=1000, help="Latent vector size")
    p_train.add_argument("--img-size", type=int, default=128, help="Training image resolution")
    p_train.add_argument("--channels", type=int, default=3, help="Image channels")
    p_train.add_argument("--base-channels", type=int, default=64,
                         help="Base channel width (64=large, 32=medium, 16=small). "
                              "Lower = smaller model, faster training, less capacity.")
    p_train.add_argument("--max-channels", type=int, default=512, help="Max channel cap")
    p_train.add_argument("--batch-size", type=int, default=64, help="Batch size")
    p_train.add_argument("--epochs", type=int, default=50, help="Number of epochs")
    p_train.add_argument("--lr", type=float, default=1e-3, help="Learning rate")
    p_train.add_argument("--beta", type=float, default=1.0, help="KL divergence weight")
    p_train.add_argument("--model-dir", default="./checkpoints", help="Checkpoint directory")
    p_train.add_argument("--data-dir", default=None, help="Custom image directory (optional)")
    p_train.add_argument("--resume", default=None, help="Resume from checkpoint path")

    # compress
    p_comp = sub.add_parser("compress", help="Compress an image to .vae format")
    p_comp.add_argument("model", help="Path to model checkpoint (.pt)")
    p_comp.add_argument("input", help="Input image (jpg, png, etc.)")
    p_comp.add_argument("output", help="Output .vae file")
    p_comp.add_argument("--verify", action="store_true", help="Also decompress to verify quality")
    p_comp.add_argument("--entropy", action="store_true", help="Apply Huffman entropy coding to latent data (saves space when distribution is skewed)")
    p_comp.add_argument("--device", default="cpu")

    # decompress
    p_decomp = sub.add_parser("decompress", help="Decompress a .vae file back to an image")
    p_decomp.add_argument("model", help="Path to model checkpoint (.pt)")
    p_decomp.add_argument("input", help="Input .vae file")
    p_decomp.add_argument("output", help="Output image (png, jpg, etc.)")
    p_decomp.add_argument("--device", default="cpu")

    # info
    p_info = sub.add_parser("info", help="Show info about a compressed .vae file")
    p_info.add_argument("input", help="Input .vae file")

    # sample
    p_samp = sub.add_parser("sample", help="Sample random images from the prior")
    p_samp.add_argument("model", help="Path to model checkpoint (.pt)")
    p_samp.add_argument("--num", type=int, default=4, help="Number of samples")
    p_samp.add_argument("--output", default="samples.png", help="Output image path")
    p_samp.add_argument("--device", default="cpu")

    args = parser.parse_args()
    if args.device is None:
        args.device = "cuda" if torch.cuda.is_available() else "cpu"

    commands = {
        "train": cmd_train,
        "compress": cmd_compress,
        "decompress": cmd_decompress,
        "info": cmd_info,
        "sample": cmd_sample,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
