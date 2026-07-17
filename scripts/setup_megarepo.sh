#!/usr/bin/env bash
# Megarepo one-shot setup — install ALL dependencies for ALL projects.
# Designed to run inside a Docker container at /megarepo.
set -euo pipefail

ROOT="${1:-/megarepo}"
cd "$ROOT"

echo "================================================"
echo "  Megarepo Dependency Installer"
echo "  $(date)"
echo "================================================"

# ── 1. Combined Python deps (PyPI) ──────────────────────────────────
echo ""
echo "── Phase 1: Python PyPI dependencies ──"
pip install --no-cache-dir --root-user-action=ignore \
  ConfigArgParse \
  "Flask>=2.3" \
  "Flask-SQLAlchemy==3.1.1" \
  "Flask-WTF>=1.1.1,<2.0" \
  GitPython \
  "Pillow>=10.0" \
  "PyYAML>=5.4" \
  "SQLAlchemy==2.0.36" \
  "Werkzeug==3.0.6" \
  black \
  bump-my-version \
  "coverage>=5.5" \
  distro \
  "eventlet>=0.35.0" \
  flask \
  "flask-cors>=4.0.0" \
  "flask-socketio>=5.3.6" \
  github-copilot-sdk \
  "gunicorn>=21.2,<22.0" \
  gymnasium \
  "jsonschema>=4.21.1" \
  "lizard>=1.17.10" \
  loguru \
  "numpy>=1.20.0" \
  prospector \
  "pydantic>=2.0.0" \
  pyfiglet \
  pygame \
  "pylint>=2.8.0" \
  pymunk \
  "pytest>=6.2.5" \
  "pytest-timeout>=2.1.0" \
  "python-socketio>=5.10.0" \
  "pyyaml>=6.0" \
  "rapidfuzz>=3.10.0" \
  "requests>=2.28" \
  "ruff>=0.6.0" \
  "scikit-image>=0.22" \
  texttable \
  "textual>=0.80" \
  tqdm

echo "  ✓ Python PyPI deps installed"

# ── 2. Heavy ML deps ────────────────────────────────────────────────
echo ""
echo "── Phase 1b: Heavy ML dependencies ──"
echo "  (torch, torchvision, tensorflow, keras, opencv-contrib-python)"

# Install in smaller batches to show progress
pip install --no-cache-dir --root-user-action=ignore "torch>=2.0" "torchvision>=0.15" 2>&1 | tail -3 || echo "  (torch skipped — disk/no-cuda)"
pip install --no-cache-dir --root-user-action=ignore "opencv-contrib-python>=4.10.0.84" 2>&1 | tail -3 || echo "  (opencv skipped)"
pip install --no-cache-dir --root-user-action=ignore tensorflow 2>&1 | tail -3 || echo "  (tensorflow skipped)"

echo "  ✓ ML deps handled"

# ── 3. Lockfile-based projects ─────────────────────────────────────
echo ""
echo "── Phase 2: Lockfile-based Python projects ──"
find . -name "requirements.lock" -not -path "*/node_modules/*" -not -path "*/.git/*" | while IFS= read -r f; do
    echo "  $f"
    pip install --require-hashes --no-deps --root-user-action=ignore -r "$f" 2>&1 | tail -1
done

# ── 4. Editable projects (monorepo-local packages) ─────────────────
echo ""
echo "── Phase 3: Editable monorepo Python packages ──"
for pkg in \
    ./active/dev-tools/full-auto-de-pdf \
    ./active/dev-tools/k33p \
    ./active/web-apps/launcher \
    ./active/web-apps/momos \
    ./active/web-apps/parambulator \
    ./active/web-apps/sub-day-generator \
    ./active/web-apps/ocr-arena \
    ./active/web-apps/image-vae-demo \
    ./active/web-apps/drop \
    ./active/games/conway_game_of_war \
    ./active/games/wizard_fight \
    ./active/games/lets-holdem-together \
    ./active/games/code_reviewdle \
    ./active/games/super_ultimate_trading_card_game \
    ./active/dev-tools/operationalize \
    ./active/dev-tools/spotify-liberator \
    ./active/dev-tools/manifold-mcp \
    ./active/dev-tools/tci-framework \
    ./active/dev-tools/bingo-probability \
    ./active/dev-tools/cli-to-web \
    ./active/dev-tools/pokemon-binder-scanner \
    ./active/dev-tools/bandcamp-matcher \
    ./active/dev-tools/slm-character-counter \
    ./active/dev-tools/full-auto-de-pdf \
    ./active/dev-tools/markdown-orphan-finder \
    ./active/dev-tools/copilot-lint-fixer \
    ./active/dev-tools/plaintext_project_management \
    ./active/dev-tools/time_function_with_timeout \
    ./active/bots/manifold-trading-framework \
    ./active/games/vroomon \
    ./active/games/MancalaAI \
    ./active/games/washing-machine-tycoon \
    ./active/games/powder_play; do
    if [ -f "$pkg/pyproject.toml" ]; then
        echo "  $pkg"
        pip install -e --root-user-action=ignore "$pkg" 2>&1 | tail -1 || echo "    (non-editable)"
    fi
done

# ── 5. Docs/scripts deps ────────────────────────────────────────────
echo ""
echo "── Phase 4: Docs/scripts dependencies ──"
if [ -f docs/requirements.txt ]; then pip install --root-user-action=ignore -r docs/requirements.txt; fi
if [ -f scripts/requirements.txt ]; then pip install --root-user-action=ignore -r scripts/requirements.txt; fi

# ── 6. Node.js deps ─────────────────────────────────────────────────
echo ""
echo "── Phase 5: Node.js dependencies ──"
find . -name "package.json" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.next/*" -not -path "*/pi-packages/*" | while IFS= read -r f; do
    d=$(dirname "$f")
    echo "  $d"
    (cd "$d" && npm install --no-audit --no-fund --ignore-scripts 2>&1 | tail -1) || echo "    (npm skip)"
done

# ── 7. Verify key imports ────────────────────────────────────────────
echo ""
echo "── Phase 6: Verify Python imports ──"
python3 -c "
imports = [
    ('flask', 'Flask'),
    ('yaml', 'PyYAML'),
    ('jinja2', 'Jinja2'),
    ('gunicorn', 'gunicorn'),
    ('PIL', 'Pillow'),
    ('numpy', 'numpy'),
    ('requests', 'requests'),
    ('tqdm', 'tqdm'),
    ('loguru', 'loguru'),
    ('torch', 'PyTorch'),
    ('cv2', 'OpenCV'),
]
ok, fail = 0, 0
for mod, label in imports:
    try:
        __import__(mod)
        ok += 1
    except ImportError:
        fail += 1
        print(f'  ✗ {label}')
print(f'  ✓ {ok} imports ok, {fail} missing')
"

echo ""
echo "================================================"
echo "  Megarepo setup complete!"
echo "  $(date)"
echo "================================================"
