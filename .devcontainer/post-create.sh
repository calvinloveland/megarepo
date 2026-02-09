#!/bin/bash
set -e

echo "🚀 Setting up Megarepo development environment..."

# Fall back to workspace ownership when host UID/GID env vars are missing.
if [ -z "${HOST_UID:-}" ] || [ -z "${HOST_GID:-}" ]; then
  repo_dir="/workspaces/megarepo"
  if [ -d "$repo_dir" ]; then
    repo_uid=$(stat -c %u "$repo_dir" 2>/dev/null || true)
    repo_gid=$(stat -c %g "$repo_dir" 2>/dev/null || true)
    if [ -n "$repo_uid" ] && [ -n "$repo_gid" ] && [ "$repo_uid" != "0" ] && [ "$repo_gid" != "0" ]; then
      export HOST_UID="$repo_uid"
      export HOST_GID="$repo_gid"
      echo "ℹ️  HOST_UID/HOST_GID not set; using workspace owner ${HOST_UID}:${HOST_GID}."
    else
      echo "ℹ️  HOST_UID/HOST_GID not set and workspace owner is root; skipping UID/GID alignment."
    fi
  fi
fi

# Align container user/group with host UID/GID when provided.
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
  current_user=$(id -un)
  current_uid=$(id -u)
  current_group=$(id -gn)
  current_gid=$(id -g)

  if [ "$HOST_GID" != "$current_gid" ]; then
    existing_group=$(getent group "$HOST_GID" | cut -d: -f1 || true)
    if [ -n "$existing_group" ]; then
      echo "🔧 Switching primary group to $existing_group (gid $HOST_GID)"
      sudo usermod -g "$HOST_GID" "$current_user"
      current_group="$existing_group"
    else
      echo "🔧 Updating group $current_group gid to $HOST_GID"
      sudo groupmod -g "$HOST_GID" "$current_group"
    fi
  fi

  if [ "$HOST_UID" != "$current_uid" ]; then
    if getent passwd "$HOST_UID" >/dev/null 2>&1; then
      echo "⚠️  UID $HOST_UID already exists; skipping usermod to avoid conflicts."
    else
      echo "🔧 Updating user $current_user uid to $HOST_UID"
      sudo usermod -u "$HOST_UID" "$current_user"
      sudo chown -R "$current_user":"$current_group" "/home/$current_user" 2>/dev/null || true
    fi
  fi
fi

# Verify SSH agent forwarding (keys must be loaded on the host).
if [ -n "${SSH_AUTH_SOCK:-}" ] && [ -S "$SSH_AUTH_SOCK" ]; then
  if ! ssh-add -L >/dev/null 2>&1; then
    echo "⚠️  SSH agent has no identities. Load keys on the host with ssh-add."
  fi
else
  echo "⚠️  SSH agent socket not available. Ensure agent forwarding is enabled."
fi

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

# Avoid chowning the workspace by default; it can fight host ownership.
# If you need chown in the container, set MEGAREPO_CHOWN_WORKSPACE=1.
REPO_DIR="/workspaces/megarepo"
if [ -d "$REPO_DIR" ]; then
  if [ "${MEGAREPO_CHOWN_WORKSPACE:-0}" = "1" ]; then
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
  else
    echo "ℹ️  Skipping workspace chown (MEGAREPO_CHOWN_WORKSPACE=1 to enable)."
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
