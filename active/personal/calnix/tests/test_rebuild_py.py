import os
import importlib.util
import sys

# Import detect_host from the new Python script
from pathlib import Path
rebuild_path = str((Path(__file__).resolve().parent / ".." / "rebuild.py").resolve())
spec = importlib.util.spec_from_file_location("rebuild_py", rebuild_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def test_detect_host_wsl(monkeypatch):
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    assert mod.detect_host() == "work-wsl"


def test_detect_host_hostname(monkeypatch):
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    # Mock hostname by overriding subprocess.check_output used in detect_host
    monkeypatch.setattr(mod.subprocess, "check_output", lambda *args, **kwargs: b"Thinker\n")
    assert mod.detect_host() == "thinker"


def test_get_repo_root():
    root = mod.get_repo_root()
    assert isinstance(root, str) and root
