import os
import importlib.util
import sys

# Import detect_host from the new Python script
from pathlib import Path
rebuild_path = str((Path(__file__).resolve().parent / ".." / "rebuild.py").resolve())
spec = importlib.util.spec_from_file_location("rebuild_py", rebuild_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def test_detect_host_hostname(monkeypatch):
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    # Mock hostname by overriding subprocess.check_output used in detect_host
    monkeypatch.setattr(mod.subprocess, "check_output", lambda *args, **kwargs: b"Thinker\n")
    assert mod.detect_host() == "thinker"


def test_get_repo_root():
    root = mod.get_repo_root()
    assert isinstance(root, str) and root


def test_get_repo_root_prefers_script_flake_over_unrelated_cwd(monkeypatch):
    script_dir = "/tmp/work/megarepo/active/personal/calnix"
    cwd = "/tmp/work/etc/nixos"

    def fake_exists(path):
        return path in {
            f"{script_dir}/flake.nix",
            f"{cwd}/flake.nix",
        }

    monkeypatch.setattr(mod.os, "getcwd", lambda: cwd)
    monkeypatch.setattr(mod, "__file__", f"{script_dir}/rebuild.py")
    monkeypatch.setattr(mod.os.path, "exists", fake_exists)
    monkeypatch.setattr(mod.subprocess, "check_output", lambda *args, **kwargs: b"/tmp/work/megarepo\n")

    assert mod.get_repo_root() == script_dir


def test_build_and_switch_flake_dry_run_skips_activation(monkeypatch):
    built = "/nix/store/abc-nixos-rebuild"
    seen_labels = []

    def fake_run_cmd_stream(cmd, as_user=None, capture=True, verbose=False, heartbeat=10, label="cmd", estimate_seconds=None):
        seen_labels.append(label)
        if label == "build":
            return 0, built
        raise AssertionError(f"unexpected command label during dry-run: {label}")

    def fake_exists(path):
        return path == os.path.join(built, "bin", "nixos-rebuild")

    monkeypatch.setattr(mod, "run_cmd_stream", fake_run_cmd_stream)
    monkeypatch.setattr(mod.os.path, "exists", fake_exists)

    ok = mod.build_and_switch_flake(
        'path:/repo#nixosConfigurations."1337book".config.system.build.nixos-rebuild',
        "path:/repo#1337book",
        "1337book",
        [],
        None,
        non_interactive=True,
        dry_run=True,
    )

    assert ok is True
    assert seen_labels == ["build"]
