import os
import importlib.util
from pathlib import Path

# load module
rebuild_path = str((Path(__file__).resolve().parent / ".." / "rebuild.py").resolve())
spec = importlib.util.spec_from_file_location("rebuild_py", rebuild_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_build_and_switch_fallback(monkeypatch, tmp_path):
    built1 = "/nix/store/abc-nixos-rebuild"
    built2 = "/nix/store/xyz-toplevel"

    def fake_run_cmd_stream(cmd, as_user=None, capture=True, verbose=False, heartbeat=10, label="cmd", estimate_seconds=None):
        s = " ".join(cmd)
        if "--print-out-paths" in s and "toplevel" not in s:
            return 0, built1
        if "--print-out-paths" in s and "toplevel" in s:
            return 0, built2
        return 0, ""

    def fake_exists(path):
        # only the toplevel's switch exists
        return path == os.path.join(built2, "bin", "switch-to-configuration")

    monkeypatch.setattr(mod, "run_cmd_stream", fake_run_cmd_stream)
    monkeypatch.setattr(mod.os.path, "exists", fake_exists)

    ok = mod.build_and_switch_flake(
        '/repo#nixosConfigurations."1337book".config.system.build.nixos-rebuild',
        "/repo#1337book",
        "1337book",
        [],
        None,
        non_interactive=True,
    )
    assert ok is True


def test_build_and_switch_new_style_uses_absolute_flake_ref(monkeypatch):
    built = "/nix/store/abc-nixos-rebuild"
    seen_switch_cmd = None
    seen_switch_capture = None

    def fake_run_cmd_stream(cmd, as_user=None, capture=True, verbose=False, heartbeat=10, label="cmd", estimate_seconds=None):
        nonlocal seen_switch_cmd, seen_switch_capture
        if label == "build":
            return 0, built
        if label == "switch":
            seen_switch_cmd = cmd
            seen_switch_capture = capture
            return 0, ""
        return 0, ""

    def fake_exists(path):
        return path == os.path.join(built, "bin", "nixos-rebuild")

    monkeypatch.setattr(mod, "run_cmd_stream", fake_run_cmd_stream)
    monkeypatch.setattr(mod.os.path, "exists", fake_exists)

    ok = mod.build_and_switch_flake(
        '/repo#nixosConfigurations."1337book".config.system.build.nixos-rebuild',
        "/repo#1337book",
        "1337book",
        [],
        None,
        non_interactive=True,
    )
    assert ok is True
    assert seen_switch_cmd is not None
    assert seen_switch_cmd[0] == "sudo"
    assert "--flake" in seen_switch_cmd
    assert "/repo#1337book" in seen_switch_cmd
    assert seen_switch_capture is True


def test_build_and_switch_reports_switch_failure_output(monkeypatch, capsys):
    built = "/nix/store/abc-nixos-rebuild"

    def fake_run_cmd_stream(cmd, as_user=None, capture=True, verbose=False, heartbeat=10, label="cmd", estimate_seconds=None):
        if label == "build":
            return 0, built
        if label == "switch":
            return 1, "error: activation failed"
        return 0, ""

    def fake_exists(path):
        return path == os.path.join(built, "bin", "nixos-rebuild")

    monkeypatch.setattr(mod, "run_cmd_stream", fake_run_cmd_stream)
    monkeypatch.setattr(mod.os.path, "exists", fake_exists)

    ok = mod.build_and_switch_flake(
        '/repo#nixosConfigurations."1337book".config.system.build.nixos-rebuild',
        "/repo#1337book",
        "1337book",
        [],
        None,
        non_interactive=True,
    )

    output = capsys.readouterr().out
    assert ok is False
    assert "Activation failed while switching to the new configuration." in output
    assert "error: activation failed" in output
