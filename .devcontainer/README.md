# Devcontainer notes

This devcontainer now installs Python 3.12 via the official devcontainer Python feature.

Rebuild container to apply changes:

- In VS Code: Command Palette -> Dev Containers: Rebuild Container

After rebuild:

- A helper virtualenv is created at `/home/vscode/.venv-copilot` containing `github-copilot-sdk` (best-effort during post-create). If installation fails due to network or permissions, activate and install manually:

  source /home/vscode/.venv-copilot/bin/activate
  pip install --upgrade pip
  pip install github-copilot-sdk

- Use that venv when testing Copilot SDK interactions:

  source /home/vscode/.venv-copilot/bin/activate
  python -c "import copilot; print('copilot ok')"

If you prefer a different workflow, you can create your own venv in the workspace instead.

**Note about file ownership:** The post-create script will attempt to fix ownership of `/workspaces/megarepo` to the container user to avoid tool issues (for example when running Nix flakes or git commands). If you see ownership or permission errors after opening the container, try rebuilding the container and ensure the workspace mount is writable by your user on the host.
