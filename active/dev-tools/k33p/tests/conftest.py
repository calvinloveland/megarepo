"""Test configuration: add src/ to sys.path so we can import k33p without
installing it. This is the standard pattern for src-layout projects that
aren't pip-installed in dev.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
