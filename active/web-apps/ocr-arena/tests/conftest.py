"""Pytest configuration for OCR Arena tests.

Adds the ``src/`` directory to ``sys.path`` so the ``ocr_arena``
package can be imported without installing the project.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
