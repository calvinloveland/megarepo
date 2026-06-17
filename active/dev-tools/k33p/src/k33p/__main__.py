"""k33p — python -m k33p entry point.

For convenience (e.g. running from a source checkout without `pip install -e`),
this entry point adds the src/ directory to sys.path so the package can
import its siblings. When the package is properly installed, this is a no-op.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from k33p.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
