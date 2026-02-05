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

    def fake_run_cmd(cmd, as_user=None, capture=False):
        s = ' '.join(cmd)
        if '--print-out-paths' in s and 'toplevel' not in s:
            return 0, built1
        if '--print-out-paths' in s and 'toplevel' in s:
            return 0, built2
        # simulate sudo switch success
        if 'switch-to-configuration' in s:
            return 0, ''
        return 0, ''

    def fake_exists(path):
        # only the toplevel's switch exists
        return path == os.path.join(built2, 'bin', 'switch-to-configuration')

    monkeypatch.setattr(mod, 'run_cmd', fake_run_cmd)
    monkeypatch.setattr(mod.os.path, 'exists', fake_exists)

    ok = mod.build_and_switch_flake('.#nixosConfigurations."1337book".config.system.build.nixos-rebuild', '1337book', [], None, non_interactive=True)
    assert ok is True
