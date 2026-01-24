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
