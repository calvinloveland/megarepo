"""Shared optional Pillow imports for OCR helpers."""
# pylint: disable=unused-import

from __future__ import annotations

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError:
    Image = None
    ImageChops = None
    ImageDraw = None
    ImageFilter = None
    ImageFont = None
    ImageOps = None
