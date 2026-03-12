"""Shared helpers for validating raster image inputs."""

from __future__ import annotations

from pathlib import Path

from .pillow_compat import Image


def validate_raster_image(image_path: Path, *, context: str) -> None:
    """Raise a helpful error when a raster image cannot be decoded."""

    if Image is None:
        raise RuntimeError(
            "Missing dependency for raster image validation: pillow. "
            "Install with `pip install pillow`."
        )
    try:
        with Image.open(image_path) as image:
            image.load()
    except (OSError, ValueError) as exc:
        raise ValueError(f"{context} unreadable or corrupt image: {image_path} ({exc})") from exc
