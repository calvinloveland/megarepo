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

# Install project-specific dependencies for active projects
echo "📦 Installing active project dependencies..."

# Dev tools
for project in active/dev-tools/*/; do
    if [ -f "${project}pyproject.toml" ]; then
        echo "  Installing $(basename $project)..."
        pip install -e "$project" 2>/dev/null || pip install -e "${project}[dev]" 2>/dev/null || true
    fi
done

# Games
for project in active/games/*/; do
    if [ -f "${project}pyproject.toml" ]; then
        echo "  Installing $(basename $project)..."
        pip install -e "$project" 2>/dev/null || pip install -e "${project}[dev]" 2>/dev/null || true
    fi
done

# Bots
if [ -f "active/bots/CryptoRoleBot/requirements.txt" ]; then
    echo "  Installing CryptoRoleBot dependencies..."
    pip install -r active/bots/CryptoRoleBot/requirements.txt 2>/dev/null || true
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
