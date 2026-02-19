#!/bin/bash
set -e

echo "🚀 Setting up Megarepo development environment..."

# Fix ownership of mounted cache directories
echo "🔧 Fixing cache directory permissions..."
sudo chown -R vscode:vscode /home/vscode/.cache/pip 2>/dev/null || true
sudo chown -R vscode:vscode /home/vscode/.npm 2>/dev/null || true

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
    "active/web-apps/parambulator"
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
