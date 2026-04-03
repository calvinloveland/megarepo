"""Tests for the tools module."""

import importlib
import json
import os
import sys
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


import src.tools as tools_module
from src.tools import (
    Coverage,
    Jscpd,
    Lizard,
    Pylint,
    Ruff,
    Tool,
    ToolRunner,
    DEFAULT_COVERAGE_TIMEOUT,
    DEFAULT_COVERAGE_XML_TIMEOUT,
    DEFAULT_LIZARD_TIMEOUT,
    DEFAULT_PYLINT_TIMEOUT,
    DEFAULT_RUFF_TIMEOUT,
)


class TestTool(unittest.TestCase):
    """Test cases for the base Tool class."""

    def test_init(self):
        """Test initialization."""
        tool = Tool("test")
        self.assertEqual(tool.name, "test")

    def test_run_not_implemented(self):
        """Test that run() raises NotImplementedError."""
        tool = Tool("test")
        with self.assertRaises(NotImplementedError):
            tool.run("/path/to/repo")


class TestPylint(unittest.TestCase):
    """Test cases for the Pylint tool."""

    def setUp(self):
        """Set up test fixtures."""
        self.pylint = Pylint()

    def test_init(self):
        """Test initialization."""
        self.assertEqual(self.pylint.name, "pylint")

    @patch("subprocess.run")
    def test_run_success(self, mock_run):
        """Test running Pylint with success."""
        # Mock the subprocess.run result
        mock_process = MagicMock()
        mock_process.returncode = 0
        mock_process.stdout = json.dumps(
            [
                {"type": "convention", "message": "Missing docstring"},
                {"type": "warning", "message": "Unused import"},
                {"type": "error", "message": "Undefined name"},
            ]
        )
        mock_run.return_value = mock_process

        # Run Pylint
        with patch.object(self.pylint, "_discover_targets", return_value=["src"]), patch.object(
            self.pylint, "_expand_targets", return_value=["src/app.py"]
        ):
            result = self.pylint.run("/path/to/repo")

        # Verify the result
        self.assertEqual(result["status"], "success")
        self.assertLess(result["score"], 10.0)  # Score should be reduced for issues
        self.assertEqual(result["issues"]["convention"], 1)
        self.assertEqual(result["issues"]["warning"], 1)
        self.assertEqual(result["issues"]["error"], 1)
        called_args, called_kwargs = mock_run.call_args
        self.assertIn("pylint", called_args[0])
        self.assertIn("--output-format=json", called_args[0])
        self.assertIn("src/app.py", called_args[0])
        self.assertEqual(called_kwargs.get("capture_output"), True)
        self.assertEqual(called_kwargs.get("text"), True)
        self.assertEqual(called_kwargs.get("check"), False)
        self.assertEqual(called_kwargs.get("cwd"), "/path/to/repo")
        self.assertEqual(called_kwargs.get("timeout"), DEFAULT_PYLINT_TIMEOUT)

    @patch("subprocess.run")
    def test_run_fail(self, mock_run):
        """Test running Pylint with failure."""
        # Mock the subprocess.run result
        mock_process = MagicMock()
        mock_process.returncode = 1
        mock_process.stdout = ""
        mock_process.stderr = "Error running pylint"
        mock_run.return_value = mock_process

        # Run Pylint
        with patch.object(self.pylint, "_discover_targets", return_value=["src"]), patch.object(
            self.pylint, "_expand_targets", return_value=["src/app.py"]
        ):
            result = self.pylint.run("/path/to/repo")

        # Verify the result
        self.assertEqual(result["status"], "error")
        self.assertEqual(result.get("failed_files"), ["src/app.py"])

    @patch("subprocess.run")
    def test_run_invalid_json(self, mock_run):
        """Test running Pylint with invalid JSON output."""
        # Mock the subprocess.run result
        mock_process = MagicMock()
        mock_process.returncode = 0
        mock_process.stdout = "Not JSON"
        mock_run.return_value = mock_process

        # Run Pylint
        with patch.object(self.pylint, "_discover_targets", return_value=["src"]), patch.object(
            self.pylint, "_expand_targets", return_value=["src/app.py"]
        ):
            result = self.pylint.run("/path/to/repo")

        # Verify the result
        self.assertEqual(result["status"], "error")
        self.assertEqual(result.get("failed_files"), ["src/app.py"])

    def test_discover_targets_prefers_src_root(self):
        """If a src directory exists, lint the src root (packages + modules)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            package = Path(tmpdir) / "src" / "full_auto_ci"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text("", encoding="utf-8")

            (Path(tmpdir) / "src" / "service.py").write_text(
                "print('hello')\n", encoding="utf-8"
            )

            discover_targets = getattr(self.pylint, "_discover_targets")
            targets = discover_targets(tmpdir)
            self.assertIn("src", targets)

    @patch("subprocess.run")
    def test_run_uses_rcfile_when_configured(self, mock_run):
        """Configured `config_file` should be forwarded to pylint as --rcfile."""
        with tempfile.TemporaryDirectory() as tmpdir:
            rcfile = Path(tmpdir) / "pylintrc"
            rcfile.write_text("[MASTER]\n", encoding="utf-8")

            tool = Pylint(config_file=str(rcfile))

            mock_process = MagicMock()
            mock_process.returncode = 0
            mock_process.stdout = "[]"
            mock_run.return_value = mock_process

            with patch.object(tool, "_discover_targets", return_value=["src"]), patch.object(
                tool, "_expand_targets", return_value=["src/app.py"]
            ):
                result = tool.run(tmpdir)

            self.assertEqual(result["status"], "success")
            called_args, called_kwargs = mock_run.call_args
            self.assertIn("pylint", called_args[0])
            self.assertIn("--output-format=json", called_args[0])
            self.assertIn("--rcfile", called_args[0])
            self.assertIn(str(rcfile), called_args[0])
            self.assertIn("src/app.py", called_args[0])
            self.assertEqual(called_kwargs.get("capture_output"), True)
            self.assertEqual(called_kwargs.get("text"), True)
            self.assertEqual(called_kwargs.get("check"), False)
            self.assertEqual(called_kwargs.get("cwd"), tmpdir)
            self.assertEqual(called_kwargs.get("timeout"), DEFAULT_PYLINT_TIMEOUT)

    def test_discover_targets_respects_config(self):
        """When explicit config exists, run Pylint from repository root."""
        with tempfile.TemporaryDirectory() as tmpdir:
            (Path(tmpdir) / ".pylintrc").write_text("", encoding="utf-8")

            discover_targets = getattr(self.pylint, "_discover_targets")
            targets = discover_targets(tmpdir)
            self.assertEqual(targets, ["."])

    def test_discover_targets_falls_back_to_packages(self):
        """If no src directory exists, fall back to top-level Python packages."""
        with tempfile.TemporaryDirectory() as tmpdir:
            pkg = Path(tmpdir) / "myapp"
            pkg.mkdir()
            (pkg / "__init__.py").write_text("", encoding="utf-8")

            discover_targets = getattr(self.pylint, "_discover_targets")
            targets = discover_targets(tmpdir)
            self.assertEqual(targets, ["myapp"])

    def test_discover_targets_defaults_to_repo(self):
        """If no obvious directories are found, lint the whole repo."""
        with tempfile.TemporaryDirectory() as tmpdir:
            discover_targets = getattr(self.pylint, "_discover_targets")
            targets = discover_targets(tmpdir)
            self.assertEqual(targets, ["."])

    def test_run_returns_default_success_when_no_files(self):
        with patch.object(self.pylint, "_discover_targets", return_value=["src"]), patch.object(
            self.pylint, "_expand_targets", return_value=[]
        ):
            result = self.pylint.run("/repo")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["score"], 10.0)
        self.assertEqual(result["issues"], {})

    def test_run_reports_top_level_exception(self):
        with patch.object(self.pylint, "_discover_targets", side_effect=OSError("boom")):
            result = self.pylint.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])

    def test_resolve_config_and_helper_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            rcfile = repo / "pylintrc"
            rcfile.write_text("[MASTER]\n", encoding="utf-8")
            self.assertEqual(Pylint(config_file="pylintrc")._resolve_config_file(tmpdir), str(rcfile))
            self.assertEqual(Pylint(config_file=str(rcfile))._resolve_config_file(tmpdir), str(rcfile))
            self.assertIsNone(Pylint(config_file="  ")._resolve_config_file(tmpdir))
            self.assertIsNone(Pylint(config_file="missing.rc")._resolve_config_file(tmpdir))

            with patch.dict(os.environ, {"PYTHONPATH": "existing"}, clear=False):
                env = Pylint._build_pylint_env(tmpdir)
            self.assertEqual(env["PYTHONPATH"], f"{tmpdir}{os.pathsep}existing")

            split_tool = Pylint(ignore_patterns=["build", "*.tmp", ".venv", ""])
            ignore_dirs, ignore_patterns = split_tool._split_ignore_patterns()
            self.assertEqual(ignore_dirs, ["build"])
            self.assertEqual(ignore_patterns, ["*.tmp", ".venv"])

    def test_expand_targets_and_discovery_helpers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            (repo / "main.py").write_text("print('ok')\n", encoding="utf-8")
            (repo / "notes.txt").write_text("x\n", encoding="utf-8")
            (repo / "src").mkdir()
            (repo / "src" / "app.py").write_text("print('app')\n", encoding="utf-8")
            (repo / "src" / "notes.txt").write_text("skip\n", encoding="utf-8")
            (repo / "build").mkdir()
            (repo / "build" / "skip.py").write_text("print('skip')\n", encoding="utf-8")
            tool = Pylint(ignore_patterns=["build"])
            expanded = tool._expand_targets(tmpdir, ["main.py", "src", "missing", "notes.txt"])
            self.assertEqual(expanded, ["main.py", "src/app.py"])
            self.assertEqual(Pylint._count_issues("bad"), {})
            self.assertEqual(Pylint._count_issues([{"type": "warning"}, "bad"]), {"warning": 1})
            self.assertEqual(Pylint._estimate_score({"error": 40}), 0.0)
            self.assertEqual(tool._sanitize_ignore_dirs(), ["build"])
            self.assertEqual(Pylint._unique_targets(["a", "b", "a"]), ["a", "b"])
            mixed_tool = Pylint(ignore_patterns=["", "build", "*.cache"])
            self.assertEqual(mixed_tool._sanitize_ignore_dirs(), ["build"])

    def test_project_target_discovery_helpers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            proj = repo / "proj"
            proj.mkdir()
            (proj / "pyproject.toml").write_text("[project]\nname='demo'\n", encoding="utf-8")
            (proj / "src").mkdir()
            (proj / "tests").mkdir()
            (proj / "tests" / "__init__.py").write_text("", encoding="utf-8")
            (proj / "pkg").mkdir()
            (proj / "pkg" / "__init__.py").write_text("", encoding="utf-8")
            self.assertEqual(self.pylint._find_python_project_roots(tmpdir), [str(proj)])
            self.assertEqual(self.pylint._project_targets(tmpdir, str(proj)), ["proj/src", "proj/tests"])
            self.assertEqual(self.pylint._discover_python_project_targets(tmpdir), ["proj/src", "proj/tests"])
            self.assertEqual(self.pylint._package_directories(str(proj)), ["pkg", "tests"])
            self.assertEqual(self.pylint._project_targets(str(proj), str(proj)), ["src", "tests"])

            fallback = repo / "fallback"
            fallback.mkdir()
            (fallback / "setup.py").write_text("from setuptools import setup\n", encoding="utf-8")
            self.assertEqual(self.pylint._project_targets(tmpdir, str(fallback)), ["fallback"])
            skipped = repo / "skipped"
            skipped.mkdir()
            (skipped / "requirements.txt").write_text("pytest\n", encoding="utf-8")
            (skipped / "tests").mkdir()
            self.assertEqual(self.pylint._project_targets(tmpdir, str(skipped)), ["skipped"])
            top = repo / "top"
            top.mkdir()
            (top / "src").mkdir()
            (top / "tests").mkdir()
            self.assertEqual(Pylint._standard_directories(str(top)), ["src"])

    def test_config_detection_helpers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            (repo / "setup.cfg").write_text("[pylint]\n", encoding="utf-8")
            self.assertTrue(self.pylint._has_explicit_config(tmpdir))
            (repo / "setup.cfg").unlink()
            (repo / "pyproject.toml").write_text("[tool.pylint.main]\n", encoding="utf-8")
            self.assertTrue(self.pylint._has_explicit_config(tmpdir))
            (repo / ".hidden.py").write_text("print('hidden')\n", encoding="utf-8")
            (repo / "visible.py").write_text("print('visible')\n", encoding="utf-8")
            self.assertEqual(Pylint._top_level_modules(tmpdir), ["visible.py"])
            hidden_pkg = repo / ".hiddenpkg"
            hidden_pkg.mkdir()
            (hidden_pkg / "__init__.py").write_text("", encoding="utf-8")
            self.assertEqual(self.pylint._package_directories(tmpdir), [])

        with patch("src.tools.os.listdir", side_effect=OSError):
            self.assertEqual(Pylint._top_level_modules("/repo"), [])
            self.assertEqual(self.pylint._package_directories("/repo"), [])
        with patch("src.tools.os.path.isfile", return_value=True), patch(
            "builtins.open", side_effect=OSError
        ):
            self.assertFalse(self.pylint._file_contains("/repo/setup.cfg", "[pylint]"))

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["pylint"], timeout=1))
    def test_run_timeout_marks_file_failed(self, _mock_run):
        with patch.object(self.pylint, "_discover_targets", return_value=["src"]), patch.object(
            self.pylint, "_expand_targets", return_value=["src/app.py"]
        ):
            result = self.pylint.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["failed_files"], ["src/app.py"])


class TestRuff(unittest.TestCase):
    """Test cases for the Ruff tool."""

    def setUp(self):
        self.ruff = Ruff()

    def test_init(self):
        """Ruff initializes with the expected defaults."""
        self.assertEqual(self.ruff.name, "ruff")
        self.assertEqual(self.ruff.timeout, DEFAULT_RUFF_TIMEOUT)

    @patch("subprocess.run")
    def test_run_success_with_findings(self, mock_run):
        """Ruff findings should be parsed into normalized issue details."""
        mock_process = MagicMock()
        mock_process.returncode = 1
        mock_process.stdout = json.dumps(
            [
                {
                    "code": "F401",
                    "message": "`os` imported but unused",
                    "filename": "/repo/src/app.py",
                    "location": {"row": 2, "column": 8},
                    "end_location": {"row": 2, "column": 10},
                }
            ]
        )
        mock_process.stderr = ""
        mock_run.return_value = mock_process

        result = self.ruff.run("/repo")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["issues"]["error"], 1)
        self.assertEqual(result["summary"]["error_count"], 1)
        self.assertEqual(result["details"][0]["path"], "src/app.py")
        self.assertEqual(result["details"][0]["code"], "F401")

    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_run_missing_binary(self, _mock_run):
        """Missing Ruff executable should return a clear error."""
        result = self.ruff.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Ruff executable not found", result["error"])

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["ruff"], timeout=1))
    def test_run_timeout(self, _mock_run):
        result = Ruff(timeout=1).run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertTrue(result["timed_out"])

    @patch("subprocess.run", side_effect=RuntimeError("boom"))
    def test_run_generic_exception(self, _mock_run):
        result = self.ruff.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])

    @patch("subprocess.run")
    def test_run_invalid_process_and_output_shapes(self, mock_run):
        process = MagicMock(returncode=2, stdout="boom", stderr="bad")
        mock_run.return_value = process
        result = self.ruff.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("return code 2", result["error"])

        process.returncode = 0
        process.stdout = "not-json"
        result = self.ruff.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("parse Ruff output", result["error"])

        process.stdout = json.dumps({"bad": True})
        result = self.ruff.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Unexpected Ruff output format", result["error"])

    @patch("src.tools.shutil.which")
    @patch("subprocess.run")
    def test_run_retries_ruff_with_nixos_fallback(self, mock_run, mock_which):
        first = MagicMock(
            returncode=127,
            stdout="",
            stderr="Could not start dynamically linked executable: ruff\n"
            "NixOS cannot run dynamically linked executables intended for generic\n"
            "linux environments out of the box.\n",
        )
        second = MagicMock(returncode=0, stdout="[]", stderr="")
        mock_run.side_effect = [first, second]
        mock_which.side_effect = ["/repo/.venv/bin/ruff", "/run/current-system/sw/bin/ruff"]

        result = self.ruff.run("/repo")

        self.assertEqual(result["status"], "success")
        self.assertEqual(mock_run.call_args_list[1][0][0][0], "/run/current-system/sw/bin/ruff")

    def test_ruff_helper_methods(self):
        self.assertEqual(Ruff._severity_from_code("f401"), "error")
        self.assertEqual(Ruff._severity_from_code("w291"), "warning")
        self.assertEqual(Ruff._severity_from_code("c901"), "warning")
        counts = Ruff._count_issues([{"type": "error"}, {"type": "custom"}])
        self.assertEqual(counts["error"], 1)
        self.assertEqual(counts["custom"], 1)
        with patch("src.tools.os.path.relpath", side_effect=ValueError):
            finding = Ruff._normalize_finding(
                {
                    "code": "F401",
                    "filename": "/repo/src/app.py",
                    "message": "unused",
                    "location": {"row": 1, "column": 2},
                    "end_location": {"row": 1, "column": 3},
                    "fix": {"edits": []},
                },
                "/repo",
            )
        self.assertEqual(finding["path"], "/repo/src/app.py")
        self.assertTrue(finding["fixable"])
        self.assertEqual(Ruff._build_command(), ["ruff", "check", "--output-format", "json", "."])
        self.assertIsNone(Ruff._build_command(None))
        retry = Ruff._should_retry_with_fallback(
            SimpleNamespace(returncode=127, stderr="NixOS cannot run dynamically linked executables")
        )
        self.assertTrue(retry)
        with patch("src.tools.shutil.which", side_effect=["/tmp/venv/bin/ruff", "/run/current-system/sw/bin/ruff"]), patch.dict(
            "src.tools.os.environ",
            {"PATH": f"/tmp/venv/bin{os.pathsep}/run/current-system/sw/bin"},
            clear=False,
        ):
            self.assertEqual(Ruff._find_fallback_binary(), "/run/current-system/sw/bin/ruff")


class TestCoverage(unittest.TestCase):
    """Test cases for the Coverage tool."""

    def setUp(self):
        """Set up test fixtures."""
        self.coverage = Coverage()

    def test_init(self):
        """Test initialization."""
        self.assertEqual(self.coverage.name, "coverage")
        self.assertEqual(self.coverage.run_tests_cmd, ["pytest"])
        self.assertEqual(self.coverage.timeout, DEFAULT_COVERAGE_TIMEOUT)
        self.assertEqual(self.coverage.xml_timeout, DEFAULT_COVERAGE_XML_TIMEOUT)
        self.assertTrue(self.coverage.auto_install_missing_dependencies)

        # Test with custom command
        custom_coverage = Coverage(
            run_tests_cmd=["python", "-m", "unittest"],
            timeout=10,
            xml_timeout=20,
        )
        self.assertEqual(custom_coverage.run_tests_cmd, ["python", "-m", "unittest"])
        self.assertEqual(custom_coverage.timeout, 10)
        self.assertEqual(custom_coverage.xml_timeout, 20)

    @patch("os.chdir")
    @patch("subprocess.run")
    @patch("os.path.exists")
    @patch("xml.etree.ElementTree.parse")
    def test_run_auto_installs_missing_module(
        self, mock_parse, mock_exists, mock_run, _mock_chdir
    ):
        """Coverage auto-installs missing modules and retries once."""
        failing_process = MagicMock()
        failing_process.returncode = 2
        failing_process.stdout = (
            "ImportError while importing test module.\n"
            "ModuleNotFoundError: No module named 'freezegun'\n"
            "=========================== short test summary info ============================\n"
            "ERROR tests/test_timed.py\n"
            "============================== 1 error in 0.10s ==============================="
        )
        failing_process.stderr = ""

        install_process = MagicMock()
        install_process.returncode = 0
        install_process.stdout = "Successfully installed freezegun"
        install_process.stderr = ""

        retry_process = MagicMock()
        retry_process.returncode = 0
        retry_process.stdout = "============================== 4 passed in 0.12s ==============================="
        retry_process.stderr = ""

        xml_process = MagicMock()
        xml_process.returncode = 0
        xml_process.stdout = ""
        xml_process.stderr = ""

        mock_run.side_effect = [
            failing_process,
            install_process,
            retry_process,
            xml_process,
        ]
        mock_exists.side_effect = lambda path: str(path).endswith("coverage.xml")

        mock_root = MagicMock()
        mock_root.get.side_effect = lambda key, default: (
            "0.90" if key == "line-rate" else default
        )
        mock_root.findall.return_value = []
        mock_tree = MagicMock()
        mock_tree.getroot.return_value = mock_root
        mock_parse.return_value = mock_tree

        result = self.coverage.run("/repo")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result.get("auto_installed_dependencies"), ["freezegun"])
        install_cmd = mock_run.call_args_list[1][0][0]
        self.assertEqual(install_cmd[:4], [sys.executable, "-m", "pip", "install"])
        self.assertIn("freezegun", install_cmd)

    @patch("os.chdir")
    @patch("subprocess.run")
    @patch("os.path.exists")
    @patch("xml.etree.ElementTree.parse")
    def test_run_success(self, mock_parse, mock_exists, mock_run, mock_chdir):
        """Test running Coverage with success."""
        # Mock the subprocess.run results
        mock_process1 = MagicMock()
        mock_process1.returncode = 0
        mock_process2 = MagicMock()
        mock_process2.returncode = 0
        mock_run.side_effect = [mock_process1, mock_process2]

        # Mock os.path.exists to return True for coverage.xml
        mock_exists.return_value = True

        # Mock XML parsing
        mock_root = MagicMock()
        mock_root.get.side_effect = lambda key, default: (
            "0.85" if key == "line-rate" else default
        )

        mock_file1 = MagicMock()
        mock_file1.get.side_effect = lambda key, default: (
            "file1.py"
            if key == "filename"
            else "0.9" if key == "line-rate" else default
        )

        mock_file2 = MagicMock()
        mock_file2.get.side_effect = lambda key, default: (
            "file2.py"
            if key == "filename"
            else "0.8" if key == "line-rate" else default
        )

        mock_root.findall.return_value = [mock_file1, mock_file2]

        mock_tree = MagicMock()
        mock_tree.getroot.return_value = mock_root
        mock_parse.return_value = mock_tree

        # Run Coverage
        result = self.coverage.run("/path/to/repo")

        # Verify the result
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["percentage"], 85.0)
        self.assertEqual(len(result["files"]), 2)
        self.assertEqual(result["files"][0]["filename"], "file1.py")
        self.assertEqual(result["files"][0]["coverage"], 90.0)
        self.assertEqual(result["files"][1]["filename"], "file2.py")
        self.assertEqual(result["files"][1]["coverage"], 80.0)
        self.assertEqual(mock_chdir.call_args_list[0][0][0], "/path/to/repo")

    @patch("os.chdir")
    @patch("subprocess.run")
    def test_run_test_fail(self, mock_run, mock_chdir):
        """Test running Coverage with test failure."""
        # Mock the subprocess.run result for test run
        mock_process = MagicMock()
        mock_process.returncode = 1
        mock_process.stdout = "Test failed"
        mock_process.stderr = "Error in tests"
        mock_run.return_value = mock_process

        # Run Coverage
        result = self.coverage.run("/path/to/repo")

        # Verify the result
        self.assertEqual(result["status"], "error")
        self.assertIn("error", result)
        self.assertEqual(result["error"], "Test run failed with return code 1")
        self.assertEqual(mock_chdir.call_args_list[0][0][0], "/path/to/repo")

    @patch("os.chdir")
    @patch("subprocess.run")
    def test_run_test_timeout(self, mock_run, mock_chdir):
        """Coverage reports a timeout when the test command hangs."""

        mock_run.side_effect = subprocess.TimeoutExpired(
            cmd=["coverage", "run", "-m", "pytest"],
            timeout=5,
            output="partial output",
            stderr="timeout error",
        )

        coverage = Coverage(timeout=5)
        result = coverage.run("/repo")

        self.assertEqual(result["status"], "error")
        self.assertIn("timed out", result["error"].lower())
        self.assertIn("timeout error", (result.get("stderr") or "").lower())
        mock_chdir.assert_called()
        # A fallback pytest collect-only may be attempted when the coverage run times out
        self.assertGreaterEqual(mock_run.call_count, 1)

    @patch("os.chdir")
    @patch("subprocess.run")
    def test_run_xml_timeout(self, mock_run, mock_chdir):
        """Coverage surfaces a timeout during XML generation."""

        mock_test_process = MagicMock()
        mock_test_process.returncode = 0
        mock_test_process.stdout = (
            "================== 1 passed in 0.50s =================="
        )
        mock_test_process.stderr = ""

        mock_run.side_effect = [
            mock_test_process,
            subprocess.TimeoutExpired(
                cmd=["coverage", "xml"],
                timeout=2.5,
                output="partial xml",
                stderr="xml timeout",
            ),
        ]

        coverage = Coverage(xml_timeout=2.5)
        result = coverage.run("/repo")

        self.assertEqual(result["status"], "error")
        self.assertIn("xml generation", result["error"].lower())
        self.assertIn("xml timeout", (result.get("stderr") or "").lower())
        self.assertEqual(mock_run.call_count, 2)
        mock_chdir.assert_called()

    def test_helper_methods_cover_edge_cases(self):
        self.assertIsNone(Coverage._parse_pytest_output(None))
        self.assertIsNone(Coverage._prepare_pytest_lines(1))
        self.assertIsNone(Coverage._prepare_pytest_lines("   "))
        self.assertIsNone(Coverage._prepare_pytest_lines("\r\n\r\n"))
        self.assertIsNone(Coverage._prepare_pytest_lines("\x1b[31m\x1b[0m"))
        prepared = Coverage._prepare_pytest_lines(
            b"\x1b[31mcollected 2 items\r\n================ 2 passed in 0.20s ================\n"
        )
        assert prepared is not None
        text, lines = prepared
        self.assertIn("collected 2 items", text)
        self.assertEqual(lines[0], "collected 2 items")
        self.assertEqual(Coverage._find_summary_line(["plain text"]), None)
        summary = Coverage._parse_summary_details("2 passed, 1 failed in 1.50s")
        self.assertEqual(summary.status, "error")
        self.assertEqual(summary.duration, 1.5)
        self.assertEqual(Coverage._extract_summary_counts("0 passed, 2 skipped"), [{"label": "skipped", "count": 2}])
        self.assertEqual(Coverage._derive_summary_status([{"label": "errors", "count": 1}]), "error")
        self.assertIsNone(Coverage._extract_duration("done soon"))
        with patch("builtins.float", side_effect=ValueError):
            self.assertIsNone(Coverage._extract_duration("in 1.20s"))
        self.assertEqual(Coverage._extract_collected_count(["collected 7 items"]), 7)
        self.assertIsNone(Coverage._extract_collected_count(["nothing"]))
        with patch("builtins.int", side_effect=ValueError):
            self.assertIsNone(Coverage._extract_collected_count(["collected 7 items"]))
        self.assertEqual(Coverage()._build_test_command()[:1], ["pytest"])
        self.assertEqual(Coverage(run_tests_cmd=["python", "-m", "unittest"])._build_test_command(), ["python", "-m", "unittest"])
        with tempfile.TemporaryDirectory() as tmpdir:
            src_dir = Path(tmpdir) / "src"
            src_dir.mkdir()
            env = Coverage._build_coverage_env(tmpdir)
            self.assertTrue(env["PYTHONPATH"].startswith(f"{src_dir}{os.pathsep}{tmpdir}"))
            self.assertTrue(Coverage._has_editable_install_target(tmpdir) is False)
            (Path(tmpdir) / "pyproject.toml").write_text("[project]\nname='demo'\n")
            self.assertTrue(Coverage._has_editable_install_target(tmpdir))
        self.assertIsNone(Coverage._normalize_subprocess_output(None))
        self.assertEqual(Coverage._normalize_subprocess_output(b"hi"), "hi")
        self.assertEqual(Coverage._normalize_subprocess_output(3), "3")
        timeout_ns = self.coverage._timeout_namespace(
            subprocess.TimeoutExpired(cmd=["x"], timeout=1, output=b"out", stderr=b"err")
        )
        self.assertEqual(timeout_ns.stdout, "out")
        self.assertEqual(timeout_ns.stderr, "err")
        self.assertEqual(Coverage._truncate_output("x" * 21000), "x" * 20000)

    def test_timeout_and_dependency_helper_methods(self):
        exc = subprocess.TimeoutExpired(cmd=["x"], timeout=5, output="partial", stderr="boom")
        with patch.object(self.coverage, "_attempt_collect_only", return_value=SimpleNamespace(returncode=0, stdout="collected 0 items", stderr="")):
            fallback = self.coverage._handle_coverage_timeout("/repo", exc)
        self.assertEqual(fallback.returncode, 5)
        with patch.object(self.coverage, "_attempt_collect_only", side_effect=subprocess.TimeoutExpired(cmd=["pytest"], timeout=1)):
            fallback = self.coverage._handle_coverage_timeout("/repo", exc)
        self.assertEqual(fallback.returncode, -1)
        with patch.object(self.coverage, "_attempt_collect_only", return_value=SimpleNamespace(returncode=0, stdout="collected 2 items", stderr="")):
            fallback = self.coverage._handle_coverage_timeout("/repo", exc)
        self.assertEqual(fallback.returncode, -1)
        with patch.object(self.coverage, "_attempt_collect_only", return_value=SimpleNamespace(returncode=1, stdout="bad", stderr="err")):
            fallback = self.coverage._handle_coverage_timeout("/repo", exc)
        self.assertEqual(fallback.returncode, -1)

        self.assertEqual(Coverage._extract_missing_modules(None, None), [])
        modules = Coverage._extract_missing_modules(
            "ModuleNotFoundError: No module named 'yaml'\nNo module named foo.bar\nNo module named foo.bar",
            "",
        )
        self.assertEqual(modules, ["yaml", "foo.bar"])
        packages = Coverage._module_packages_to_install(["yaml", "foo_bar", "foo-bar", " "], ["PyYAML"])
        self.assertIn("foo_bar", packages)
        self.assertIn("foo-bar", packages)
        self.assertEqual(Coverage._module_to_package_candidates("dateutil"), ["python-dateutil", "dateutil"])
        with patch.dict(Coverage.MODULE_PACKAGE_ALIASES, {"dup": "dup"}, clear=False):
            self.assertEqual(Coverage._module_to_package_candidates("dup"), ["dup"])
        self.assertIsNone(Coverage._append_output(None, None))
        self.assertEqual(Coverage._append_output("one", "two"), "one\ntwo")

        process = SimpleNamespace(returncode=1, stdout="No module named freezegun", stderr="")
        with patch.object(self.coverage, "_install_packages", return_value=(SimpleNamespace(returncode=-1, stdout="", stderr=""), 1.0, True)):
            retried = self.coverage._retry_after_dependency_install("/repo", process, 0.5, False)
        self.assertIn("timed out", retried[4] or "")

        with patch.object(self.coverage, "_install_packages", return_value=(SimpleNamespace(returncode=1, stdout="pip failed", stderr="stderr"), 1.0, False)):
            retried = self.coverage._retry_after_dependency_install("/repo", process, 0.5, False)
        self.assertIn("Dependency auto-install failed", retried[4] or "")

        with patch.object(self.coverage, "_has_editable_install_target", return_value=True), patch.object(
            self.coverage,
            "_install_editable_project",
            return_value=(SimpleNamespace(returncode=0, stdout="ok", stderr=""), 1.0, False),
        ), patch.object(
            self.coverage,
            "_run_coverage_subprocess",
            return_value=(SimpleNamespace(returncode=0, stdout="ok", stderr=""), 0.5, False),
        ):
            retried = self.coverage._retry_after_dependency_install("/repo", process, 0.5, False)
        self.assertEqual(retried[0].returncode, 0)
        self.assertEqual(retried[3], [])

    def test_result_builder_helpers(self):
        run_ctx = Coverage._RunContext(
            returncode=5,
            duration=1.0,
            stdout="out",
            stderr="err",
            pytest_details=None,
            pytest_summary={"status": "success"},
            embedded_results=[{"tool": "pytest"}],
            auto_installed_dependencies=["freezegun"],
            timed_out=False,
        )
        skipped = self.coverage._build_test_failure_result(run_ctx)
        self.assertEqual(skipped["status"], "skipped")
        self.assertIn("pytest_summary", skipped)
        timed_out_ctx = Coverage._RunContext(
            returncode=1,
            duration=1.0,
            stdout="out",
            stderr="boom",
            pytest_details=None,
            pytest_summary=None,
            embedded_results=[],
            auto_installed_dependencies=[],
            timed_out=True,
        )
        error = self.coverage._build_test_failure_result(timed_out_ctx)
        self.assertIn("timed out", error["error"])
        no_stderr_timeout = Coverage._RunContext(
            returncode=1,
            duration=1.0,
            stdout="out",
            stderr=None,
            pytest_details=None,
            pytest_summary=None,
            embedded_results=[],
            auto_installed_dependencies=[],
            timed_out=True,
        )
        error = self.coverage._build_test_failure_result(no_stderr_timeout)
        self.assertIn("Coverage test run timed out", error["error"])
        xml_timeout = Coverage._XmlContext(returncode=-1, duration=0.5, stdout="xo", stderr="xe", timed_out=True)
        xml_error = self.coverage._build_xml_failure_result(timed_out_ctx, xml_timeout)
        self.assertIn("XML generation timed out", xml_error["error"])
        xml_timeout = Coverage._XmlContext(returncode=-1, duration=0.5, stdout="xo", stderr=None, timed_out=True)
        xml_error = self.coverage._build_xml_failure_result(timed_out_ctx, xml_timeout)
        self.assertIn("Coverage XML generation timed out", xml_error["error"])
        xml_fail = Coverage._XmlContext(returncode=2, duration=0.5, stdout="xo", stderr="xe", timed_out=False)
        xml_error = self.coverage._build_xml_failure_result(timed_out_ctx, xml_fail)
        self.assertIn("return code 2", xml_error["error"])
        success = self.coverage._build_success_result(80.0, [{"filename": "a.py", "coverage": 75.0}], 2.0, run_ctx)
        self.assertEqual(success["status"], "success")
        self.assertIn("auto_installed_dependencies", success)

    @patch("subprocess.run")
    def test_generate_xml_timeout_and_missing_report(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["coverage", "xml"], timeout=1, output=b"partial", stderr=b"boom")
        xml_ctx = Coverage(xml_timeout=1)._generate_coverage_xml()
        self.assertTrue(xml_ctx.timed_out)
        self.assertEqual(xml_ctx.stdout, "partial")
        self.assertEqual(xml_ctx.stderr, "boom")
        with self.assertRaises(FileNotFoundError):
            self.coverage._load_coverage_report("/definitely/missing")

    def test_run_inside_repository_missing_xml_file(self):
        run_ctx = Coverage._RunContext(
            returncode=0,
            duration=1.0,
            stdout="out",
            stderr="err",
            pytest_details=None,
            pytest_summary=None,
            embedded_results=[],
            auto_installed_dependencies=[],
        )
        xml_ctx = Coverage._XmlContext(returncode=0, duration=0.5, stdout="", stderr="")
        with patch.object(self.coverage, "_execute_coverage_run", return_value=run_ctx), patch.object(
            self.coverage, "_generate_coverage_xml", return_value=xml_ctx
        ), patch.object(self.coverage, "_load_coverage_report", side_effect=FileNotFoundError):
            result = self.coverage._run_inside_repository("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Coverage XML file not found", result["error"])

    def test_run_catches_top_level_exception_and_install_timeout(self):
        with patch("src.tools.os.chdir", side_effect=[RuntimeError("boom"), None]):
            result = self.coverage.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["pip"], timeout=1, output="out", stderr="err")):
            process, _duration, timed_out = self.coverage._install_packages("/repo", ["demo"])
        self.assertTrue(timed_out)
        self.assertEqual(process.stderr, "err")
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["pip"], timeout=1, output="out", stderr="err")):
            process, _duration, timed_out = self.coverage._install_editable_project("/repo")
        self.assertTrue(timed_out)
        self.assertEqual(process.stderr, "err")

    def test_execute_coverage_run_appends_install_error(self):
        process = SimpleNamespace(returncode=1, stdout="stdout", stderr="stderr")
        rerun = SimpleNamespace(returncode=1, stdout="stdout", stderr="stderr")
        with patch.object(self.coverage, "_run_coverage_subprocess", return_value=(process, 1.0, False)), patch.object(
            self.coverage,
            "_retry_after_dependency_install",
            return_value=(rerun, 2.0, False, ["pkg"], "install failed"),
        ):
            ctx = self.coverage._execute_coverage_run("/repo")
        self.assertEqual(ctx.stderr, "stderr\ninstall failed")
        self.assertEqual(ctx.auto_installed_dependencies, ["pkg"])


class TestLizard(unittest.TestCase):
    """Test cases for the Lizard cyclomatic complexity tool."""

    def setUp(self):
        self.lizard = Lizard(max_ccn=8)

    @patch("subprocess.run")
    def test_run_success_module(self, mock_run):
        """Lizard should aggregate per-file XML payloads into one summary."""
        xml_payload = """
<?xml version="1.0" ?>
<cppncss>
    <measure type="Function">
        <labels>
            <label>Nr.</label>
            <label>NCSS</label>
            <label>CCN</label>
        </labels>
        <item name="foo(...) at pkg/module.py:12">
            <value>1</value>
            <value>30</value>
            <value>12</value>
        </item>
    </measure>
</cppncss>
""".strip()
        xml_payload_b = """
<?xml version="1.0" ?>
<cppncss>
    <measure type="Function">
        <labels>
            <label>Nr.</label>
            <label>NCSS</label>
            <label>CCN</label>
        </labels>
        <item name="bar(...) at pkg/other.py:4">
            <value>1</value>
            <value>15</value>
            <value>6</value>
        </item>
    </measure>
</cppncss>
""".strip()

        process_a = MagicMock(returncode=0, stdout=xml_payload, stderr="")
        process_b = MagicMock(returncode=0, stdout=xml_payload_b, stderr="")
        mock_run.side_effect = [process_a, process_b]

        with patch.object(
            self.lizard,
            "_discover_python_files",
            return_value=["/repo/pkg/module.py", "/repo/pkg/other.py"],
        ):
            result = self.lizard.run("/repo")

        self.assertEqual(result["status"], "success")
        summary = result.get("summary")
        self.assertIsNotNone(summary)
        self.assertEqual(summary["total_functions"], 2)
        self.assertAlmostEqual(summary["average_ccn"], 9.0)
        self.assertEqual(summary["above_threshold"], 1)
        self.assertIn("top_offenders", result)
        self.assertEqual(result["top_offenders"][0]["name"], "foo(...)")

        self.assertEqual(mock_run.call_count, 2)

    @patch("subprocess.run")
    def test_run_cli_success(self, mock_run):
        """Lizard CLI XML output should produce parsed summary metrics."""
        xml_payload = """
<?xml version="1.0" ?>
<cppncss>
    <measure type="Function">
        <labels>
            <label>Nr.</label>
            <label>NCSS</label>
            <label>CCN</label>
        </labels>
        <item name="foo(...) at pkg/module.py:12">
            <value>1</value>
            <value>30</value>
            <value>12</value>
        </item>
        <item name="bar(...) at pkg/other.py:4">
            <value>1</value>
            <value>15</value>
            <value>6</value>
        </item>
    </measure>
</cppncss>
""".strip()

        mock_process = MagicMock()
        mock_process.returncode = 0
        mock_process.stdout = xml_payload
        mock_process.stderr = ""
        mock_run.return_value = mock_process

        with patch.object(
            self.lizard, "_discover_python_files", return_value=["/repo/pkg/module.py"]
        ):
            result = self.lizard.run("/repo")

        self.assertEqual(result["status"], "success")
        summary = result.get("summary")
        self.assertIsNotNone(summary)
        self.assertEqual(summary["total_functions"], 2)
        self.assertAlmostEqual(summary["average_ccn"], 9.0)
        self.assertEqual(summary["above_threshold"], 1)
        self.assertIn("top_offenders", result)
        self.assertEqual(result["top_offenders"][0]["name"], "foo(...)")

        mock_run.assert_called_with(
            ["lizard", "--xml", "/repo/pkg/module.py"],
            capture_output=True,
            text=True,
            check=False,
            cwd="/repo",
            timeout=DEFAULT_LIZARD_TIMEOUT,
        )

    @patch("subprocess.run")
    def test_run_cli_failure(self, mock_run):
        """Non-zero Lizard CLI exits should return an error result."""
        mock_process = MagicMock()
        mock_process.returncode = 1
        mock_process.stdout = ""
        mock_process.stderr = "boom"
        mock_run.return_value = mock_process

        with patch.object(
            self.lizard, "_discover_python_files", return_value=["/repo/pkg/module.py"]
        ):
            result = self.lizard.run("/repo")

        self.assertEqual(result["status"], "error")
        self.assertIn("Lizard CLI failed", result["error"])

    @patch("subprocess.run")
    def test_run_cli_invalid_xml(self, mock_run):
        """Invalid XML output should be surfaced as a parse error."""
        mock_process = MagicMock()
        mock_process.returncode = 0
        mock_process.stdout = "not xml"
        mock_process.stderr = ""
        mock_run.return_value = mock_process

        with patch.object(
            self.lizard, "_discover_python_files", return_value=["/repo/pkg/module.py"]
        ):
            result = self.lizard.run("/repo")

        self.assertEqual(result["status"], "error")
        self.assertIn("Failed to parse", result["error"])

    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_run_missing_binary(self, _mock_run):
        """Missing lizard executable should return a clear error message."""
        with patch.object(
            self.lizard, "_discover_python_files", return_value=["/repo/pkg/module.py"]
        ):
            result = self.lizard.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Lizard executable not found", result["error"])

    def test_helper_methods(self):
        file_infos = [
            SimpleNamespace(
                filename="/repo/pkg/module.py",
                function_list=[
                    SimpleNamespace(name="foo", long_name="foo()", start_line=3, cyclomatic_complexity=4, nloc=10),
                    SimpleNamespace(name="skip", long_name="skip()", start_line=4, cyclomatic_complexity=None, nloc=5),
                ],
            ),
            SimpleNamespace(filename=None, function_list=[]),
        ]
        functions = self.lizard._collect_module_functions("/repo", file_infos)
        self.assertEqual(len(functions), 1)
        self.assertEqual(Lizard._xml_function_measure(""), None)
        self.assertIsNone(Lizard._safe_float("bad"))
        self.assertIsNone(Lizard._safe_int("bad"))
        item = ET.fromstring("<item name='foo at pkg/module.py:not-a-line'><value>1</value><value>bad</value></item>")
        self.assertIsNone(self.lizard._parse_xml_function_item("/repo", item, ["Nr.", "CCN"]))
        self.assertEqual(self.lizard._extract_location_from_cli_name("/repo", "foo")[0], "foo")
        self.assertTrue(
            self.lizard._extract_location_from_cli_name("/repo", "foo at pkg/module.py")[1].endswith(
                "pkg/module.py"
            )
        )
        with patch("src.tools.os.path.relpath", side_effect=ValueError):
            self.assertEqual(self.lizard._normalize_path("/repo", "/repo/pkg/module.py"), "/repo/pkg/module.py")

    def test_discover_python_files_and_cli_helper_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            (repo / "pkg").mkdir()
            (repo / "pkg" / "a.py").write_text("print('a')\n", encoding="utf-8")
            (repo / ".venv").mkdir()
            (repo / ".venv" / "skip.py").write_text("print('skip')\n", encoding="utf-8")
            files = self.lizard._discover_python_files(tmpdir)
            self.assertEqual(files, [str(repo / "pkg" / "a.py")])
        self.assertIn(".venv", Lizard._sanitize_ignore_dirs())
        with patch.object(tools_module, "DEFAULT_PYLINT_IGNORE_DIRS", ["", "*.cache", ".venv"]):
            self.assertEqual(Lizard._sanitize_ignore_dirs(), [".venv"])

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["lizard"], timeout=1))
    def test_run_via_cli_timeout(self, _mock_run):
        result = Lizard(timeout=1)._run_via_cli("/repo")
        self.assertEqual(result["status"], "error")
        self.assertTrue(result["timed_out"])

    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_run_via_cli_missing_binary(self, _mock_run):
        result = self.lizard._run_via_cli("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Lizard executable not found", result["error"])

    @patch("subprocess.run", side_effect=RuntimeError("boom"))
    def test_run_via_cli_launch_error(self, _mock_run):
        result = self.lizard._run_via_cli("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])

    @patch("subprocess.run")
    def test_run_via_cli_nonzero_and_parse_error(self, mock_run):
        mock_run.return_value = MagicMock(returncode=2, stdout="out", stderr="err")
        result = self.lizard._run_via_cli("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("returned 2", result["error"])

        mock_run.return_value = MagicMock(returncode=0, stdout="<bad", stderr="")
        result = self.lizard._run_via_cli("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("Failed to parse Lizard XML output", result["error"])

        xml_payload = """
        <?xml version="1.0" ?>
        <cppncss>
            <measure type="Function">
                <labels><label>Nr.</label><label>NCSS</label><label>CCN</label></labels>
                <item name="foo(...) at pkg/module.py:12"><value>1</value><value>30</value><value>12</value></item>
            </measure>
        </cppncss>
        """.strip()
        mock_run.return_value = MagicMock(returncode=0, stdout=xml_payload, stderr="")
        result = self.lizard._run_via_cli("/repo")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["summary"]["total_functions"], 1)

    @patch("subprocess.run")
    def test_run_via_cli_per_file_collects_timeout_and_failures(self, mock_run):
        mock_run.side_effect = [
            subprocess.TimeoutExpired(cmd=["lizard"], timeout=1),
            RuntimeError("boom"),
            MagicMock(returncode=1, stdout="", stderr="err"),
            MagicMock(returncode=0, stdout="<bad", stderr=""),
        ]
        with patch.object(
            self.lizard,
            "_discover_python_files",
            return_value=["a.py", "b.py", "c.py", "d.py"],
        ):
            result = self.lizard.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["timed_out_files"], ["a.py"])
        self.assertIn("b.py", result["failed_files"])
        self.assertIn("c.py", result["failed_files"])
        self.assertIn("d.py", result["failed_files"])

    def test_parse_xml_output_helper_edges(self):
        self.assertEqual(self.lizard._parse_xml_output("/repo", "<cppncss />"), [])
        measure = ET.fromstring("<measure><item><value>1</value><value>9</value></item></measure>")
        self.assertEqual(Lizard._xml_measure_labels(measure), [])
        self.assertIsNone(Lizard._safe_float(None))
        self.assertIsNone(Lizard._safe_int(None))


class TestJscpd(unittest.TestCase):
    def setUp(self):
        self.jscpd = Jscpd()

    @patch("subprocess.run")
    def test_run_success_and_threshold_warning(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as tmpdir:
            report = {
                "statistics": {
                    "total": {
                        "lines": 100,
                        "tokens": 500,
                        "duplicatedLines": 10,
                        "duplicatedTokens": 50,
                        "percentage": "12.5%",
                        "sources": 4,
                    }
                },
                "duplicates": [
                    {
                        "lines": 8,
                        "tokens": 40,
                        "firstFile": {"name": "a.py", "start": 1, "end": 8},
                        "secondFile": {"name": "b.py", "start": 10, "end": 17},
                        "fragment": "x" * 600,
                    }
                ],
            }
            Path(tmpdir, "jscpd-report.json").write_text(json.dumps(report), encoding="utf-8")
            result = Jscpd(threshold=10.0).run(tmpdir)
            self.assertEqual(result["status"], "warning")
            self.assertEqual(result["summary"]["percentage"], 12.5)
            self.assertEqual(result["summary"]["clones_found"], 1)
            self.assertEqual(len(result["duplicates"][0]["fragment"]), 500)

    @patch("subprocess.run")
    def test_run_uses_report_subdirectory_and_parse_errors(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as tmpdir:
            report_dir = Path(tmpdir) / "report"
            report_dir.mkdir()
            (report_dir / "jscpd-report.json").write_text("{bad json", encoding="utf-8")
            result = self.jscpd.run(tmpdir)
            self.assertEqual(result["status"], "error")
            self.assertIn("Failed to parse jscpd report", result["error"])

    @patch("subprocess.run")
    def test_run_cleans_up_report_even_when_remove_fails(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as tmpdir:
            report = {"statistics": {"total": {}}, "duplicates": []}
            Path(tmpdir, "jscpd-report.json").write_text(json.dumps(report), encoding="utf-8")
            with patch("src.tools.os.remove", side_effect=OSError):
                result = self.jscpd.run(tmpdir)
        self.assertEqual(result["status"], "success")

    @patch("subprocess.run")
    def test_run_falls_back_to_stdout_parser(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
        with tempfile.TemporaryDirectory() as tmpdir:
            result = self.jscpd.run(tmpdir)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["summary"]["clones_found"], 0)

        error_result = self.jscpd._parse_stdout(
            subprocess.CompletedProcess(args=["jscpd"], returncode=1, stdout="", stderr="boom"),
            1.0,
        )
        self.assertEqual(error_result["status"], "error")

    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["jscpd"], timeout=1))
    def test_run_timeout(self, _mock_run):
        result = Jscpd(timeout=1).run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertTrue(result["timed_out"])

    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_run_missing_binary(self, _mock_run):
        result = self.jscpd.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("jscpd not found", result["error"])

    @patch("subprocess.run", side_effect=RuntimeError("boom"))
    def test_run_launch_error(self, _mock_run):
        result = self.jscpd.run("/repo")
        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])


def test_progress_falls_back_without_tqdm(monkeypatch):
    monkeypatch.setattr(tools_module, "tqdm", None)
    assert list(tools_module._progress([1, 2, 3])) == [1, 2, 3]


def test_tools_module_import_without_tqdm(monkeypatch):
    real_import = __import__

    def fake_import(name, *args, **kwargs):
        if name == "tqdm":
            raise ImportError("no tqdm")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", fake_import)
    reloaded = importlib.reload(tools_module)
    try:
        assert reloaded.tqdm is None
    finally:
        monkeypatch.setattr("builtins.__import__", real_import)
        importlib.reload(tools_module)


class TestToolRunner(unittest.TestCase):
    """Test cases for the ToolRunner."""

    def setUp(self):
        """Set up test fixtures."""
        self.runner = ToolRunner()

    def test_init(self):
        """Test initialization."""
        self.assertEqual(len(self.runner.tools), 0)

        # Test with tools
        tool1 = Tool("tool1")
        tool2 = Tool("tool2")
        runner = ToolRunner(tools=[tool1, tool2])
        self.assertEqual(len(runner.tools), 2)
        self.assertEqual(runner.tools[0].name, "tool1")
        self.assertEqual(runner.tools[1].name, "tool2")

    def test_add_tool(self):
        """Test adding a tool."""
        tool = Tool("test")
        self.runner.add_tool(tool)
        self.assertEqual(len(self.runner.tools), 1)
        self.assertEqual(self.runner.tools[0].name, "test")

    def test_run_all(self):
        """Test running all tools."""
        # Create mock tools
        tool1 = MagicMock()
        tool1.name = "tool1"
        tool1.run.return_value = {"status": "success", "score": 9.5}

        tool2 = MagicMock()
        tool2.name = "tool2"
        tool2.run.return_value = {"status": "error", "error": "Something went wrong"}

        # Add tools to runner
        self.runner.add_tool(tool1)
        self.runner.add_tool(tool2)

        # Run all tools
        results = self.runner.run_all("/path/to/repo")

        # Verify the results
        self.assertEqual(len(results), 2)
        self.assertEqual(results["tool1"]["status"], "success")
        self.assertEqual(results["tool1"]["score"], 9.5)
        self.assertEqual(results["tool2"]["status"], "error")
        self.assertEqual(results["tool2"]["error"], "Something went wrong")

        # Verify that each tool's run method was called
        tool1.run.assert_called_once_with("/path/to/repo")
        tool2.run.assert_called_once_with("/path/to/repo")


if __name__ == "__main__":
    unittest.main()
