#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "calnix_cli.py"
SPEC = importlib.util.spec_from_file_location("calnix_cli", MODULE_PATH)
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


class CalnixCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.state_dir = Path(self.tempdir.name) / "state"
        self.repo_root = Path(self.tempdir.name) / "repo"
        self.repo_root.mkdir(parents=True)
        (self.repo_root / "flake.nix").write_text('{ description = "test"; }\n')
        (self.repo_root / "rebuild.py").write_text('# test rebuild shim\n')
        (self.repo_root / "flake.lock").write_text(
            json.dumps(
                {
                    "nodes": {
                        "nixpkgs": {
                            "locked": {
                                "owner": "NixOS",
                                "repo": "nixpkgs",
                                "rev": "currentrev1234567890"
                            }
                        }
                    }
                }
            )
        )
        self.registry_env = {"CALNIX_REGISTRY_FILE": str(ROOT / "package-health-registry.json")}

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def run_cli(self, argv: list[str]) -> tuple[int, str]:
        stdout = io.StringIO()
        with patch.dict(os.environ, self.registry_env, clear=False), redirect_stdout(stdout):
            rc = CLI.main(["--state-dir", str(self.state_dir), *argv])
        return rc, stdout.getvalue()

    def load_state(self) -> dict:
        return json.loads((self.state_dir / "state.json").read_text())

    def test_confirm_records_current_revision(self) -> None:
        with patch.object(CLI, "evaluate_package_version", return_value="4.8.1"):
            rc, output = self.run_cli([
                "package",
                "confirm",
                "darktable",
                "--repo",
                str(self.repo_root),
                "--notes",
                "worked after a long edit session",
            ])
        self.assertEqual(rc, 0)
        self.assertIn("Confirmed darktable 4.8.1", output)
        payload = self.load_state()
        confirmation = payload["packages"]["darktable"]["confirmations"][0]
        self.assertEqual(confirmation["nixpkgs_rev"], "currentrev1234567890")
        self.assertEqual(confirmation["version"], "4.8.1")

    def test_mark_failing_prefers_last_confirmed_revision(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / "state.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "packages": {
                        "darktable": {
                            "confirmations": [
                                {
                                    "timestamp": "2026-03-20T00:00:00Z",
                                    "nixpkgs_rev": "oldergoodrev9999",
                                    "version": "4.6.0",
                                    "policy": "revision"
                                }
                            ],
                            "failures": [],
                            "observations": []
                        }
                    }
                }
            )
        )
        rc, output = self.run_cli([
            "package",
            "mark-failing",
            "darktable",
            "--repo",
            str(self.repo_root),
            "--notes",
            "crashes on startup",
        ])
        self.assertEqual(rc, 0)
        self.assertIn("revision", output)
        payload = self.load_state()
        package_state = payload["packages"]["darktable"]
        self.assertEqual(package_state["active_policy"], "revision")
        self.assertEqual(package_state["active_revision"], "oldergoodrev9999")
        self.assertEqual(package_state["failures"][0]["nixpkgs_rev"], "currentrev1234567890")

    def test_use_current_resets_policy(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / "state.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "packages": {
                        "darktable": {
                            "confirmations": [],
                            "failures": [],
                            "observations": [],
                            "active_policy": "revision",
                            "active_revision": "oldergoodrev9999"
                        }
                    }
                }
            )
        )
        rc, _ = self.run_cli(["package", "use-current", "darktable", "--notes", "retry upstream fix"])
        self.assertEqual(rc, 0)
        payload = self.load_state()
        package_state = payload["packages"]["darktable"]
        self.assertEqual(package_state["active_policy"], "current")
        self.assertIsNone(package_state["active_revision"])
        self.assertEqual(package_state["observations"][0]["kind"], "policy-reset")

    def test_generation_list_reads_saved_metadata(self) -> None:
        generations_dir = self.state_dir / "generations"
        generations_dir.mkdir(parents=True, exist_ok=True)
        (generations_dir / "42.json").write_text(
            json.dumps(
                {
                    "generation": 42,
                    "timings": {"total_seconds": 123},
                    "robustness": {"status": "degraded"}
                }
            )
        )
        rc, output = self.run_cli(["generation", "list", "--limit", "1"])
        self.assertEqual(rc, 0)
        self.assertIn("generation 42: 123s degraded", output)


if __name__ == "__main__":
    unittest.main()
