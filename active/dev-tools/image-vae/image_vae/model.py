"""
VAE model definition for extreme image compression.

Architecture:
  - Encoder: strided convolutions down to 4×4 spatial, then flatten → latent dim
  - Decoder: latent → reshape to 4×4, transposed convolutions up to output size
  - Configurable latent dimension, image size, and channel depth
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F


# ---------------------------------------------------------------------------
# Utility blocks
# ---------------------------------------------------------------------------

class ConvBlock(nn.Module):
    """Strided convolution → BatchNorm → LeakyReLU."""

    def __init__(self, in_ch: int, out_ch: int, kernel: int = 4, stride: int = 2, padding: int = 1):
        super().__init__()
        self.conv = nn.Conv2d(in_ch, out_ch, kernel, stride, padding, bias=False)
        self.bn = nn.BatchNorm2d(out_ch)
        self.act = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.conv(x)))


class DeconvBlock(nn.Module):
    """Transposed convolution → BatchNorm → LeakyReLU."""

    def __init__(self, in_ch: int, out_ch: int, kernel: int = 4, stride: int = 2, padding: int = 1):
        super().__init__()
        self.deconv = nn.ConvTranspose2d(in_ch, out_ch, kernel, stride, padding, bias=False)
        self.bn = nn.BatchNorm2d(out_ch)
        self.act = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.deconv(x)))


# ---------------------------------------------------------------------------
# Encoder
# ---------------------------------------------------------------------------

class Encoder(nn.Module):
    """Downsampling encoder: image → mu, logvar."""

    def __init__(
        self,
        latent_dim: int,
        img_channels: int = 3,
        img_size: int = 128,
        base_channels: int = 64,
        max_channels: int = 512,
    ):
        super().__init__()
        self.latent_dim = latent_dim
        self.img_size = img_size

        # Number of 2× downsampling steps to reach 4×4 spatial
        num_layers = int(math.log2(img_size)) - 2  # e.g. 128 → 5, 64 → 4, 32 → 3
        self.num_layers = num_layers
        self.final_spatial = 4

        # Channel progression: double each layer, cap at max_channels
        channels = [img_channels]
        ch = base_channels
        for i in range(num_layers):
            channels.append(min(ch, max_channels))
            ch *= 2
        # Trim to num_layers + 1 entries
        channels = channels[: num_layers + 1]

        convs = []
        for i in range(num_layers):
            convs.append(ConvBlock(channels[i], channels[i + 1]))
        self.convs = nn.Sequential(*convs)

        self.final_ch = channels[-1]
        self.flatten_dim = self.final_ch * self.final_spatial * self.final_spatial

        self.fc_mu = nn.Linear(self.flatten_dim, latent_dim)
        self.fc_logvar = nn.Linear(self.flatten_dim, latent_dim)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.convs(x)
        h = h.reshape(h.size(0), -1)
        mu = self.fc_mu(h)
        logvar = self.fc_logvar(h)
        return mu, logvar


# ---------------------------------------------------------------------------
# Decoder
# ---------------------------------------------------------------------------

class Decoder(nn.Module):
    """Upsampling decoder: latent → reconstructed image."""

    def __init__(
        self,
        latent_dim: int,
        img_channels: int = 3,
        img_size: int = 128,
        base_channels: int = 64,
        max_channels: int = 512,
    ):
        super().__init__()
        self.latent_dim = latent_dim
        self.img_size = img_size
        self.img_channels = img_channels

        num_layers = int(math.log2(img_size)) - 2
        self.num_layers = num_layers
        self.final_spatial = 4

        # Reverse channel progression (mirror of encoder)
        ch = base_channels
        max_ch = min(max_channels, ch * (2 ** (num_layers - 1)))
        # Build channel list for decoder: [start_ch, ..., img_channels]
        dec_channels = [max_ch]
        for i in range(num_layers - 1, 0, -1):
            dec_channels.append(min(ch * (2 ** (i - 1)), max_channels))
        dec_channels.append(img_channels)

        self.fc = nn.Linear(latent_dim, dec_channels[0] * self.final_spatial * self.final_spatial)

        deconvs = []
        for i in range(num_layers):
            in_ch = dec_channels[i]
            out_ch = dec_channels[i + 1]
            if i == num_layers - 1:
                # Last layer: no batchnorm, Sigmoid output
                deconvs.append(nn.Sequential(
                    nn.ConvTranspose2d(in_ch, out_ch, 4, 2, 1),
                    nn.Sigmoid(),
                ))
            else:
                deconvs.append(DeconvBlock(in_ch, out_ch))
        self.deconvs = nn.Sequential(*deconvs)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        h = self.fc(z)
        h = h.reshape(h.size(0), -1, self.final_spatial, self.final_spatial)
        h = self.deconvs(h)
        return h


# ---------------------------------------------------------------------------
# Full VAE
# ---------------------------------------------------------------------------

class VAE(nn.Module):
    """Variational Autoencoder for extreme image compression."""

    def __init__(
        self,
        latent_dim: int = 1000,
        img_channels: int = 3,
        img_size: int = 128,
        base_channels: int = 64,
        max_channels: int = 512,
    ):
        super().__init__()
        self.latent_dim = latent_dim
        self.img_channels = img_channels
        self.img_size = img_size
        self.base_channels = base_channels
        self.max_channels = max_channels
        self.encoder = Encoder(latent_dim, img_channels, img_size, base_channels, max_channels)
        self.decoder = Decoder(latent_dim, img_channels, img_size, base_channels, max_channels)

    def reparameterize(self, mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        """Reparameterization trick: z = mu + exp(0.5 * logvar) * epsilon."""
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + eps * std

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Forward pass: encode → reparameterize → decode. Returns (recon, mu, logvar)."""
        mu, logvar = self.encoder(x)
        z = self.reparameterize(mu, logvar)
        recon = self.decoder(z)
        return recon, mu, logvar

    def encode_deterministic(self, x: torch.Tensor) -> torch.Tensor:
        """Encode without sampling (used for compression). Returns mu only."""
        mu, _ = self.encoder(x)
        return mu

    def decode(self, z: torch.Tensor) -> torch.Tensor:
        """Decode a latent vector into an image."""
        return self.decoder(z)

    @torch.no_grad()
    def sample(self, num_samples: int, device: str = "cpu") -> torch.Tensor:
        """Sample random latents from N(0, I) and decode."""
        z = torch.randn(num_samples, self.latent_dim, device=device)
        return self.decoder(z)


# ---------------------------------------------------------------------------
# Loss function
# ---------------------------------------------------------------------------

def vae_loss(
    recon: torch.Tensor,
    target: torch.Tensor,
    mu: torch.Tensor,
    logvar: torch.Tensor,
    beta: float = 1.0,
) -> dict[str, torch.Tensor]:
    """
    Compute VAE loss = reconstruction loss + beta * KL divergence.

    Returns dict with keys: 'loss', 'recon_loss', 'kl_loss'.
    """
    # Binary cross-entropy (assumes pixel values in [0, 1])
    recon_loss = F.binary_cross_entropy(recon, target, reduction="sum") / target.size(0)

    # KL divergence: -0.5 * sum(1 + logvar - mu^2 - exp(logvar))
    kl_loss = -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp(), dim=1).mean()

    total = recon_loss + beta * kl_loss
    return {"loss": total, "recon_loss": recon_loss, "kl_loss": kl_loss}
