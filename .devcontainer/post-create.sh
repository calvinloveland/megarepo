#!/bin/bash
set -e

echo "🚀 Setting up Megarepo development environment..."

# Upgrade pip
pip install --upgrade pip

# Install common Python dev tools
pip install \
    pytest \
    pytest-cov \
    black \
    ruff \
    mypy \
    hatch \
    build \
    twine

# Install all active projects with pyproject.toml in editable mode
echo "📦 Installing active projects in editable mode..."

PROJECTS=(
    "active/dev-tools/cli-to-web"
    "active/dev-tools/full-auto-ci"
    "active/dev-tools/operationalize"
    "active/dev-tools/plaintext_project_management"
    "active/dev-tools/time_function_with_timeout"
    "active/games/conway_game_of_war"
    "active/games/lets-holdem-together"
    "active/games/MancalaAI"
    "active/games/vroomon"
)

for project in "${PROJECTS[@]}"; do
    if [ -f "${project}/pyproject.toml" ]; then
        name=$(basename "$project")
        echo "  Installing $name..."
        # Try with [dev] extras first, then without
        pip install -e "${project}[dev]" 2>/dev/null || pip install -e "$project" 2>/dev/null || echo "    ⚠️  Failed to install $name (may have missing dependencies)"
    fi
done

# Bots with requirements.txt
if [ -f "active/bots/CryptoRoleBot/requirements.txt" ]; then
    echo "  Installing CryptoRoleBot dependencies..."
    pip install -r active/bots/CryptoRoleBot/requirements.txt 2>/dev/null || echo "    ⚠️  Failed to install CryptoRoleBot dependencies"
fi

# VS Code extension dependencies
if [ -f "active/dev-tools/operationalize_vscode_ext/package.json" ]; then
    echo "📦 Installing VS Code extension dependencies..."
    cd active/dev-tools/operationalize_vscode_ext
    npm install 2>/dev/null || true
    cd - > /dev/null
fi

# Setup git hooks directory (optional)
echo "🔧 Configuring git..."
git config --global init.defaultBranch main
git config --global pull.rebase false

# Ensure workspace ownership is correct to avoid issues with tools that
# require repository ownership to match the invoking user (e.g., Nix flakes
# when evaluating local git inputs). If ownership doesn't match the current
# user, try to fix it (best-effort). If chown fails, the user may need to fix
# ownership on the host.
REPO_DIR="/workspaces/megarepo"
if [ -d "$REPO_DIR" ]; then
  repo_owner_uid=$(stat -c %u "$REPO_DIR" 2>/dev/null || true)
  my_uid=$(id -u)
  if [ -n "$repo_owner_uid" ] && [ "$repo_owner_uid" != "$my_uid" ]; then
    user_name=$(id -un)
    group_name=$(id -gn)
    echo "⚠️  Fixing ownership of $REPO_DIR to $user_name:$group_name to avoid permission issues (this may change host-side ownership)."
    if sudo chown -R "$user_name:$group_name" "$REPO_DIR" 2>/dev/null; then
      echo "    ✅ Ownership of $REPO_DIR fixed to $user_name:$group_name"
    else
      echo "    ⚠️ Could not chown $REPO_DIR; this is usually because the workspace mount is owned/managed by the host and disallows chown from the container."
      echo "    To fix on the host, run (as the host user with sufficient privileges):"
      echo "      sudo chown -R $user_name:$group_name /path/to/workspace"
      echo "    Or update the bind mount options so the container user matches the host owner."
    fi
  fi
fi

echo ""
# Setup Copilot SDK virtualenv (Python 3.12 required)
if command -v python3 >/dev/null 2>&1; then
  PYV=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
  echo "🔁 Creating Copilot SDK virtualenv at /home/vscode/.venv-copilot using python $PYV"
  # Create venv if missing (best-effort)
  python3 -m venv /home/vscode/.venv-copilot 2>/dev/null || python -m venv /home/vscode/.venv-copilot 2>/dev/null || true
  /bin/bash -lc "source /home/vscode/.venv-copilot/bin/activate && python -m pip install --upgrade pip setuptools wheel && pip install github-copilot-sdk" || echo "    ⚠️ Could not install github-copilot-sdk automatically; run 'source /home/vscode/.venv-copilot/bin/activate && pip install github-copilot-sdk' after rebuilding the container"
else
  echo "⚠️ python3 not found; Copilot SDK venv not created. Rebuild the devcontainer to install Python 3.12."
fi

echo ""
echo "✅ Development environment ready!"
echo ""
echo "Project locations:"
echo "  Dev tools: active/dev-tools/"
echo "  Games:     active/games/"
echo "  Bots:      active/bots/"
echo "  Personal:  active/personal/"
echo "  Archive:   archive/"
echo ""
echo "Run 'pytest' in any project directory to run tests."

# Install helper scripts on PATH
if [ -f "/workspaces/megarepo/.devcontainer/bin/hivemindllm" ]; then
    echo "🔧 Installing hivemindllm helper..."
    sudo ln -sf /workspaces/megarepo/.devcontainer/bin/hivemindllm /usr/local/bin/hivemindllm
    sudo chmod +x /workspaces/megarepo/.devcontainer/bin/hivemindllm
fi
