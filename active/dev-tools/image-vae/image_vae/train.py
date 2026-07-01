"""
Training utilities for the image VAE.

Supports CIFAR-10 out of the box (quick training loop) and custom
image directories via a simple Dataset wrapper.
"""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from torchvision import datasets, transforms

from .model import VAE, vae_loss


# ---------------------------------------------------------------------------
# Dataset helpers
# ---------------------------------------------------------------------------

def make_cifar_loader(batch_size: int = 64, img_size: int = 32, root: str = "./data") -> DataLoader:
    """
    Create a DataLoader for CIFAR-10, resized to `img_size`.

    Note: For best results with the 1KB VAE, train on higher-resolution
    datasets (e.g. CelebA, a custom photo directory, or LSUN).
    CIFAR-10 is useful for quick functional testing.
    """
    transform = transforms.Compose([
        transforms.Resize((img_size, img_size)),
        transforms.ToTensor(),  # scales to [0, 1]
    ])
    dataset = datasets.CIFAR10(root=root, train=True, download=True, transform=transform)
    return DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=2)


class ImageFolderDataset(Dataset):
    """Load images from a directory tree, resizing to target_size."""

    def __init__(self, root: str | Path, target_size: int = 128, extensions: tuple = (".jpg", ".jpeg", ".png")):
        self.paths = sorted(
            p for p in Path(root).rglob("*") if p.suffix.lower() in extensions
        )
        self.target_size = target_size
        self.transform = transforms.Compose([
            transforms.Resize((target_size, target_size)),
            transforms.ToTensor(),
        ])
        if not self.paths:
            raise FileNotFoundError(f"No images found under {root}")

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        from PIL import Image
        img = Image.open(self.paths[idx]).convert("RGB")
        return self.transform(img)


# ---------------------------------------------------------------------------
# Training function
# ---------------------------------------------------------------------------

class Trainer:
    """Manages the training loop for the VAE image compressor."""

    def __init__(
        self,
        model: VAE,
        train_loader: DataLoader,
        val_loader: Optional[DataLoader] = None,
        lr: float = 1e-3,
        beta: float = 1.0,
        device: str = "cpu",
        model_dir: str | Path = "./checkpoints",
    ):
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device
        self.beta = beta
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)

        self.optimizer = optim.Adam(model.parameters(), lr=lr, betas=(0.5, 0.999))
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, mode="min", factor=0.5, patience=5, min_lr=1e-6
        )

        self.history: dict[str, list[float]] = {
            "train_loss": [],
            "train_recon": [],
            "train_kl": [],
            "val_loss": [],
            "val_recon": [],
            "val_kl": [],
        }

    def train_epoch(self) -> dict[str, float]:
        self.model.train()
        total_loss = 0.0
        total_recon = 0.0
        total_kl = 0.0
        n_batches = 0

        for batch in self.train_loader:
            if isinstance(batch, (list, tuple)):
                x = batch[0]  # dataset returns (img, label)
            else:
                x = batch

            x = x.to(self.device)
            recon, mu, logvar = self.model(x)

            losses = vae_loss(recon, x, mu, logvar, beta=self.beta)

            self.optimizer.zero_grad()
            losses["loss"].backward()
            # Gradient clipping to prevent exploding gradients
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()

            total_loss += losses["loss"].item()
            total_recon += losses["recon_loss"].item()
            total_kl += losses["kl_loss"].item()
            n_batches += 1

        return {
            "loss": total_loss / n_batches,
            "recon": total_recon / n_batches,
            "kl": total_kl / n_batches,
        }

    @torch.no_grad()
    def validate(self) -> dict[str, float]:
        if self.val_loader is None:
            return {"loss": 0.0, "recon": 0.0, "kl": 0.0}

        self.model.eval()
        total_loss = 0.0
        total_recon = 0.0
        total_kl = 0.0
        n_batches = 0

        for batch in self.val_loader:
            x = batch[0] if isinstance(batch, (list, tuple)) else batch
            x = x.to(self.device)
            recon, mu, logvar = self.model(x)
            losses = vae_loss(recon, x, mu, logvar, beta=self.beta)

            total_loss += losses["loss"].item()
            total_recon += losses["recon_loss"].item()
            total_kl += losses["kl_loss"].item()
            n_batches += 1

        return {
            "loss": total_loss / n_batches,
            "recon": total_recon / n_batches,
            "kl": total_kl / n_batches,
        }

    def save_checkpoint(self, epoch: int, tag: str = "latest"):
        path = self.model_dir / f"vae_{tag}.pt"
        torch.save({
            "epoch": epoch,
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "history": self.history,
            "latent_dim": self.model.latent_dim,
            "img_size": self.model.img_size,
            "img_channels": self.model.img_channels,
            "base_channels": self.model.base_channels,
            "max_channels": self.model.max_channels,
        }, path)
        return path

    def load_checkpoint(self, path: str | Path):
        ckpt = torch.load(path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(ckpt["model_state_dict"])
        self.optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        self.history = ckpt["history"]
        return ckpt["epoch"]

    def train(
        self,
        num_epochs: int = 50,
        save_every: int = 10,
        log_every: int = 1,
    ):
        print(f"Training on {self.device} | latent_dim={self.model.latent_dim} "
              f"img_size={self.model.img_size} | beta={self.beta}")
        print(f"{'Epoch':>6} | {'Train Loss':>10} | {'Train Recon':>12} | {'Train KL':>10} | "
              f"{'Val Loss':>10} | {'Val Recon':>12} | {'Val KL':>10} | {'LR':>10} | {'Time':>8}")
        print("-" * 100)

        for epoch in range(1, num_epochs + 1):
            t0 = time.time()

            train_metrics = self.train_epoch()
            val_metrics = self.validate()

            for key in self.history:
                if "train" in key:
                    suffix = key.replace("train_", "")
                    self.history[key].append(train_metrics.get(suffix, 0.0))
                elif "val" in key:
                    suffix = key.replace("val_", "")
                    self.history[key].append(val_metrics.get(suffix, 0.0))

            self.scheduler.step(val_metrics["loss"])
            current_lr = self.optimizer.param_groups[0]["lr"]

            elapsed = time.time() - t0

            if epoch % log_every == 0:
                print(
                    f"{epoch:>6} | {train_metrics['loss']:>10.4f} | "
                    f"{train_metrics['recon']:>12.4f} | {train_metrics['kl']:>10.4f} | "
                    f"{val_metrics['loss']:>10.4f} | "
                    f"{val_metrics['recon']:>12.4f} | {val_metrics['kl']:>10.4f} | "
                    f"{current_lr:>1.2e} | {elapsed:>7.1f}s"
                )

            if epoch % save_every == 0 or epoch == num_epochs:
                self.save_checkpoint(epoch, tag=f"epoch_{epoch}")
                self.save_checkpoint(epoch, tag="latest")

        final_path = self.save_checkpoint(num_epochs, tag="final")
        print(f"\nTraining complete. Final checkpoint: {final_path}")
        return final_path


def train_vae(
    latent_dim: int = 1000,
    img_size: int = 128,
    img_channels: int = 3,
    base_channels: int = 64,
    max_channels: int = 512,
    batch_size: int = 64,
    num_epochs: int = 50,
    lr: float = 1e-3,
    beta: float = 1.0,
    device: Optional[str] = None,
    model_dir: str = "./checkpoints",
    data_dir: Optional[str] = None,
    resume: Optional[str] = None,
) -> VAE:
    """
    Convenience function: create VAE, load data, train, return model.

    If ``data_dir`` is provided, loads images from that directory.
    Otherwise uses CIFAR-10 (train on 32x32 for quick prototyping).

    Args:
        base_channels: Channel width for first conv layer (controls model size).
                       Lower = smaller model, faster training.
                       Recommended: 64 (default), 32 (fast), 16 (tiny).
        max_channels: Maximum channel count in any layer.
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    model = VAE(
        latent_dim=latent_dim,
        img_channels=img_channels,
        img_size=img_size,
        base_channels=base_channels,
        max_channels=max_channels,
    )

    if data_dir:
        dataset = ImageFolderDataset(data_dir, target_size=img_size)
        train_size = int(0.9 * len(dataset))
        val_size = len(dataset) - train_size
        train_ds, val_ds = torch.utils.data.random_split(dataset, [train_size, val_size])
        train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2)
        val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=2)
    else:
        # Fallback to CIFAR-10 at img_size (will be blurry for large img_size, but works for testing)
        print("No data_dir provided — using CIFAR-10. For serious use, provide a custom image directory.")
        transform = transforms.Compose([
            transforms.Resize((img_size, img_size)),
            transforms.ToTensor(),
        ])
        train_dataset = datasets.CIFAR10(root="./data", train=True, download=True, transform=transform)
        val_dataset = datasets.CIFAR10(root="./data", train=False, download=True, transform=transform)
        train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=2)
        val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=2)

    trainer = Trainer(model, train_loader, val_loader, lr=lr, beta=beta, device=device, model_dir=model_dir)

    if resume:
        start_epoch = trainer.load_checkpoint(resume)
        print(f"Resumed from epoch {start_epoch}")

    trainer.train(num_epochs=num_epochs)

    return model
