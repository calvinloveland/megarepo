"""Tools for code analysis and testing."""

import json
import logging
import os
import re
import subprocess
import time
from typing import Iterable, TypeVar
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

T = TypeVar("T")


def _progress(iterable: Iterable[T], **kwargs: Any) -> Iterable[T]:
    try:
        from tqdm import tqdm
    except ImportError:
        return iterable
    return tqdm(iterable, **kwargs)

# Default timeout values (in seconds)
DEFAULT_PYLINT_TIMEOUT = 300  # 5 minutes
DEFAULT_COVERAGE_TIMEOUT = 600  # 10 minutes
DEFAULT_COVERAGE_XML_TIMEOUT = 120  # 2 minutes
DEFAULT_LIZARD_TIMEOUT = 300  # 5 minutes
DEFAULT_JSCPD_TIMEOUT = 300  # 5 minutes

# Default directories to ignore when running pylint or scanning for Python projects
DEFAULT_PYLINT_IGNORE_DIRS = [
    ".git",
    ".venv",
    "venv",
    ".env",
    "env",
    "node_modules",
    "__pycache__",
    ".tox",
    ".nox",
    ".eggs",
    "archive",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
]


class Tool:  # pylint: disable=too-few-public-methods
    """Base class for all tools."""

    def __init__(self, name: str):
        """Initialize a tool.

        Args:
            name: Tool name
        """
        self.name = name

    def run(self, repo_path: str) -> Dict[str, Any]:
        """Run the tool.

        Args:
            repo_path: Path to the repository

        Returns:
            Tool results
        """
        raise NotImplementedError("Subclasses must implement this method")


class Pylint(Tool):  # pylint: disable=too-few-public-methods
    """Pylint code analysis tool."""

    def __init__(
        self,
        config_file: Optional[str] = None,
        *,
        timeout: Optional[float] = None,
        ignore_patterns: Optional[List[str]] = None,
    ):
        """Initialize Pylint.

        Args:
            config_file: Path to pylint configuration file
            timeout: Timeout in seconds for pylint execution
            ignore_patterns: Directories or patterns to ignore
        """
        super().__init__("pylint")
        self.config_file = config_file
        self.timeout = timeout if timeout is not None else DEFAULT_PYLINT_TIMEOUT
        self.ignore_patterns = (
            ignore_patterns
            if ignore_patterns is not None
            else DEFAULT_PYLINT_IGNORE_DIRS
        )

    def _resolve_config_file(self, repo_path: str) -> Optional[str]:
        config_file = self.config_file
        if not config_file or not isinstance(config_file, str):
            return None

        candidate = os.path.expanduser(config_file.strip())
        if not candidate:
            return None

        if os.path.isabs(candidate):
            return candidate if os.path.isfile(candidate) else None

        repo_candidate = os.path.join(repo_path, candidate)
        return repo_candidate if os.path.isfile(repo_candidate) else None

    def run(self, repo_path: str) -> Dict[str, Any]:
        """Run Pylint one file at a time.

        Args:
            repo_path: Path to the repository

        Returns:
            Pylint results
        """
        try:
            targets = self._discover_targets(repo_path)
            files = self._expand_targets(repo_path, targets)
            logger.info(
                "Running Pylint on %s (%d files)", repo_path, len(files)
            )

            if not files:
                return {
                    "status": "success",
                    "score": 10.0,
                    "issues": {},
                    "details": [],
                }

            details: List[Dict[str, Any]] = []
            issues_by_type: Dict[str, int] = {}
            failed_files: List[str] = []
            env = os.environ.copy()
            existing = env.get("PYTHONPATH")
            env["PYTHONPATH"] = (
                repo_path if not existing else f"{repo_path}{os.pathsep}{existing}"
            )

            for file_path in _progress(files, desc="pylint", unit="file"):
                cmd = self._build_command(repo_path, [file_path])
                try:
                    process = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        check=False,
                        cwd=repo_path,
                        env=env,
                        timeout=self.timeout,
                    )
                except subprocess.TimeoutExpired:
                    logger.error("Pylint timed out on %s", file_path)
                    failed_files.append(file_path)
                    continue

                parsed = self._parse_process(process)
                if parsed.get("status") == "success":
                    file_details = parsed.get("details") or []
                    if isinstance(file_details, list):
                        details.extend(file_details)
                    file_issues = parsed.get("issues") or {}
                    for issue_type, count in file_issues.items():
                        issues_by_type[issue_type] = issues_by_type.get(issue_type, 0) + count
                else:
                    failed_files.append(file_path)

            score = self._estimate_score(issues_by_type)
            status = "success" if not failed_files else "error"
            result: Dict[str, Any] = {
                "status": status,
                "score": score,
                "issues": issues_by_type,
                "details": details,
            }
            if failed_files:
                result["failed_files"] = failed_files
            return result
        except Exception as error:  # pylint: disable=broad-except
            logger.exception("Error running Pylint")
            return {"status": "error", "error": str(error)}

    def _build_command(self, repo_path: str, targets: List[str]) -> List[str]:
        cmd = ["pylint", "--output-format=json"]
        rcfile = self._resolve_config_file(repo_path)
        if rcfile:
            cmd.extend(["--rcfile", rcfile])
        ignore_dirs, ignore_patterns = self._split_ignore_patterns()
        if ignore_dirs:
            cmd.extend(["--ignore", ",".join(ignore_dirs)])
        if ignore_patterns:
            cmd.extend(["--ignore-patterns", ",".join(ignore_patterns)])
        cmd.extend(targets)
        return cmd

    def _expand_targets(self, repo_path: str, targets: List[str]) -> List[str]:
        files: List[str] = []
        ignore_dirs = set(self._sanitize_ignore_dirs())
        for target in targets:
            target_path = os.path.join(repo_path, target)
            if os.path.isfile(target_path):
                if target_path.endswith(".py"):
                    files.append(target)
                continue
            if not os.path.isdir(target_path):
                continue
            for root, dirs, filenames in os.walk(target_path):
                dirs[:] = [name for name in dirs if name not in ignore_dirs]
                for filename in filenames:
                    if not filename.endswith(".py"):
                        continue
                    full_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(full_path, repo_path)
                    files.append(rel_path)
        return sorted(set(files))

    def _split_ignore_patterns(self) -> Tuple[List[str], List[str]]:
        ignore_dirs: List[str] = []
        ignore_patterns: List[str] = []
        for pattern in self.ignore_patterns:
            if not pattern:
                continue
            if "*" in pattern or "." in pattern:
                ignore_patterns.append(pattern)
                continue
            ignore_dirs.append(pattern)
        return ignore_dirs, ignore_patterns

    @staticmethod
    def _count_issues(results: Any) -> Dict[str, int]:
        issues_by_type: Dict[str, int] = {}
        if not isinstance(results, list):
            return issues_by_type
        for item in results:
            if not isinstance(item, dict):
                continue
            issue_type = item.get("type", "unknown")
            issues_by_type[issue_type] = issues_by_type.get(issue_type, 0) + 1
        return issues_by_type

    @staticmethod
    def _estimate_score(issues_by_type: Dict[str, int]) -> float:
        score = 10.0
        penalties = {
            "error": 0.5,
            "warning": 0.2,
            "convention": 0.1,
        }
        for issue_type, count in issues_by_type.items():
            score -= penalties.get(issue_type, 0.0) * count
        return max(0.0, score)

    def _parse_process(self, process: Any) -> Dict[str, Any]:
        if process.returncode < 0 or not process.stdout:
            logger.error("Pylint failed with return code %s", process.returncode)
            return {
                "status": "error",
                "error": f"Pylint failed with return code {process.returncode}",
                "stdout": getattr(process, "stdout", None),
                "stderr": getattr(process, "stderr", None),
            }

        try:
            results = json.loads(process.stdout)
        except json.JSONDecodeError:
            logger.error("Failed to parse Pylint JSON output")
            return {"status": "error", "error": "Failed to parse Pylint output"}

        issues_by_type = self._count_issues(results)
        score = self._estimate_score(issues_by_type)

        return {
            "status": "success",
            "score": score,
            "issues": issues_by_type,
            "details": results,
        }

    def _discover_targets(self, repo_path: str) -> List[str]:
        """Determine which paths Pylint should analyze for the given repository."""

        if self._has_explicit_config(repo_path):
            return ["."]

        targets: List[str] = []
        targets.extend(self._standard_directories(repo_path))
        targets.extend(self._top_level_modules(repo_path))

        if not targets:
            targets.extend(self._package_directories(repo_path))

        if not targets:
            targets.extend(self._discover_python_project_targets(repo_path))

        if not targets:
            return ["."]

        return self._unique_targets(targets)

    def _discover_python_project_targets(self, repo_path: str) -> List[str]:
        project_roots = self._find_python_project_roots(repo_path)
        targets: List[str] = []
        for root in project_roots:
            targets.extend(self._project_targets(repo_path, root))
        return targets

    def _project_targets(self, repo_path: str, project_root: str) -> List[str]:
        rel_root = os.path.relpath(project_root, repo_path)
        if rel_root == ".":
            rel_root = ""

        targets: List[str] = []
        for candidate in ["src", "tests", "ui_tests"]:
            candidate_path = os.path.join(project_root, candidate)
            if os.path.isdir(candidate_path):
                if candidate in {"tests", "ui_tests"} and not self._is_package_dir(
                    project_root, candidate
                ):
                    continue
                rel_candidate = os.path.join(rel_root, candidate) if rel_root else candidate
                targets.append(rel_candidate)

        if not targets:
            targets.append(rel_root or ".")
        return targets

    def _find_python_project_roots(self, repo_path: str) -> List[str]:
        project_markers = {"pyproject.toml", "setup.cfg", "setup.py", "requirements.txt"}
        ignore_dirs = set(self._sanitize_ignore_dirs())
        roots: List[str] = []

        for current_root, dirs, files in os.walk(repo_path):
            dirs[:] = [
                name
                for name in dirs
                if name not in ignore_dirs
            ]
            if project_markers.intersection(files):
                roots.append(current_root)
                dirs[:] = []

        return roots

    def _sanitize_ignore_dirs(self) -> List[str]:
        ignore_dirs: List[str] = []
        for pattern in self.ignore_patterns:
            if not pattern:
                continue
            if "*" in pattern:
                continue
            ignore_dirs.append(pattern.strip("/"))
        return ignore_dirs

    @staticmethod
    def _unique_targets(targets: List[str]) -> List[str]:
        seen: set[str] = set()
        unique_targets: List[str] = []
        for target in targets:
            if target in seen:
                continue
            seen.add(target)
            unique_targets.append(target)
        return unique_targets

    @staticmethod
    def _standard_directories(repo_path: str) -> List[str]:
        candidates = ["src", "tests", "ui_tests"]
        targets: List[str] = []
        for candidate in candidates:
            if os.path.isdir(os.path.join(repo_path, candidate)):
                if candidate in {"tests", "ui_tests"} and not Pylint._is_package_dir(
                    repo_path, candidate
                ):
                    continue
                targets.append(candidate)
        return targets

    @staticmethod
    def _is_package_dir(base_path: str, directory: str) -> bool:
        init_path = os.path.join(base_path, directory, "__init__.py")
        return os.path.isfile(init_path)

    @staticmethod
    def _top_level_modules(repo_path: str) -> List[str]:
        try:
            entries = sorted(os.listdir(repo_path))
        except OSError:
            return []

        modules: List[str] = []
        for entry in entries:
            if not entry.endswith(".py"):
                continue
            if entry.startswith("."):
                continue
            full_path = os.path.join(repo_path, entry)
            if os.path.isfile(full_path):
                modules.append(entry)
        return modules

    def _package_directories(self, base_path: str) -> List[str]:
        """Return Python package directories directly under ``base_path``."""

        try:
            entries = sorted(os.listdir(base_path))
        except OSError:
            return []

        packages: List[str] = []
        for entry in entries:
            if entry.startswith("."):
                continue
            full_path = os.path.join(base_path, entry)
            if not os.path.isdir(full_path):
                continue
            init_file = os.path.join(full_path, "__init__.py")
            if os.path.isfile(init_file):
                packages.append(entry)
        return packages

    def _has_explicit_config(self, repo_path: str) -> bool:
        """Return True if the repository supplies its own Pylint configuration."""

        config_files = [".pylintrc", "pylintrc"]
        for config in config_files:
            if os.path.isfile(os.path.join(repo_path, config)):
                return True

        setup_cfg = os.path.join(repo_path, "setup.cfg")
        if self._file_contains(setup_cfg, "[pylint]"):
            return True

        pyproject = os.path.join(repo_path, "pyproject.toml")
        if self._file_contains(pyproject, "[tool.pylint"):
            return True

        return False

    def _file_contains(self, path: str, needle: str) -> bool:
        if not os.path.isfile(path):
            return False

        try:
            with open(path, "r", encoding="utf-8") as handle:
                return needle in handle.read()
        except OSError:
            return False


# Default directories to ignore when running pytest
# These commonly contain test files from installed packages that shouldn't be run
DEFAULT_PYTEST_IGNORE_PATTERNS = [
    ".venv",
    "venv",
    ".env",
    "env",
    "node_modules",
    ".git",
    "__pycache__",
    ".tox",
    ".nox",
    ".eggs",
    "*.egg-info",
    "archive",
    "ui_tests",
    "build",
    "dist",
    ".mypy_cache",
    ".pytest_cache",
]


class Coverage(Tool):  # pylint: disable=too-few-public-methods
    """Coverage measurement tool."""

    def __init__(
        self,
        run_tests_cmd: Optional[List[str]] = None,
        *,
        timeout: Optional[float] = None,
        xml_timeout: Optional[float] = None,
        ignore_patterns: Optional[List[str]] = None,
    ):
        """Initialize Coverage.

        Args:
            run_tests_cmd: Command to run tests (defaults to pytest)
            timeout: Timeout in seconds for test execution
            xml_timeout: Timeout in seconds for XML report generation
            ignore_patterns: List of directory patterns to ignore when running pytest
        """
        super().__init__("coverage")
        self.run_tests_cmd = run_tests_cmd or ["pytest"]
        self.timeout = timeout if timeout is not None else DEFAULT_COVERAGE_TIMEOUT
        self.xml_timeout = (
            xml_timeout if xml_timeout is not None else DEFAULT_COVERAGE_XML_TIMEOUT
        )
        self.ignore_patterns = (
            ignore_patterns
            if ignore_patterns is not None
            else DEFAULT_PYTEST_IGNORE_PATTERNS
        )

    ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

    @dataclass
    class _RunContext:
        returncode: int
        duration: float
        stdout: Optional[str]
        stderr: Optional[str]
        pytest_details: Optional[Dict[str, Any]]
        pytest_summary: Optional[Dict[str, Any]]
        embedded_results: List[Dict[str, Any]]
        timed_out: bool = False

    @dataclass
    class _XmlContext:
        returncode: int
        duration: float
        stdout: Optional[str]
        stderr: Optional[str]
        timed_out: bool = False

    @dataclass
    class _PytestSummary:
        status: str
        counts: List[Dict[str, Any]]
        duration: Optional[float]

    def run(self, repo_path: str) -> Dict[str, Any]:
        """Run coverage.

        Args:
            repo_path: Path to the repository

        Returns:
            Coverage results
        """
        original_dir = os.getcwd()
        try:
            os.chdir(repo_path)
            return self._run_inside_repository(repo_path)
        except Exception as error:  # pylint: disable=broad-except
            logger.exception("Error running Coverage")
            return {"status": "error", "error": str(error)}
        finally:
            os.chdir(original_dir)

    def _run_inside_repository(self, repo_path: str) -> Dict[str, Any]:
        run_ctx = self._execute_coverage_run(repo_path)
        if run_ctx.returncode != 0:
            return self._build_test_failure_result(run_ctx)

        xml_ctx = self._generate_coverage_xml()
        if xml_ctx.returncode != 0:
            return self._build_xml_failure_result(run_ctx, xml_ctx)

        try:
            coverage_pct, files_coverage = self._load_coverage_report(repo_path)
        except FileNotFoundError:
            logger.error("Coverage XML file not found")
            return {"status": "error", "error": "Coverage XML file not found"}

        total_duration = run_ctx.duration + xml_ctx.duration
        return self._build_success_result(
            coverage_pct,
            files_coverage,
            total_duration,
            run_ctx,
        )

    @classmethod
    def _parse_pytest_output(cls, stdout: Optional[str]) -> Optional[Dict[str, Any]]:
        prepared = cls._prepare_pytest_lines(stdout)
        if not prepared:
            return None

        text, lines = prepared
        summary_line = cls._find_summary_line(lines)
        summary = cls._parse_summary_details(summary_line)
        collected = cls._extract_collected_count(lines)
        raw_output = cls._truncate_output(text)

        return {
            "status": summary.status,
            "summary": summary_line,
            "counts": summary.counts,
            "collected": collected,
            "duration": summary.duration,
            "raw_output": raw_output,
        }

    @classmethod
    def _prepare_pytest_lines(
        cls, stdout: Optional[str]
    ) -> Optional[Tuple[str, List[str]]]:
        if stdout is None:
            return None

        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        elif not isinstance(stdout, str):
            return None

        if not stdout.strip():
            return None

        text = cls.ANSI_ESCAPE_RE.sub("", stdout).replace("\r\n", "\n")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines:
            return None

        return text, lines

    @staticmethod
    def _find_summary_line(lines: List[str]) -> Optional[str]:
        for line in reversed(lines):
            if line.startswith("=") and line.endswith("="):
                candidate = line.strip("= ")
                if candidate:
                    return candidate
        return None

    @classmethod
    def _parse_summary_details(
        cls, summary_line: Optional[str]
    ) -> "Coverage._PytestSummary":
        if not summary_line:
            return cls._PytestSummary(status="success", counts=[], duration=None)

        counts = cls._extract_summary_counts(summary_line)
        status = cls._derive_summary_status(counts)
        duration = cls._extract_duration(summary_line)
        return cls._PytestSummary(status=status, counts=counts, duration=duration)

    @staticmethod
    def _extract_summary_counts(summary_line: str) -> List[Dict[str, Any]]:
        counts: List[Dict[str, Any]] = []
        for count_str, label in re.findall(r"(\d+)\s+([A-Za-z_]+)", summary_line):
            count = int(count_str)
            if count <= 0:
                continue
            label_lower = label.lower()
            counts.append({"label": label_lower, "count": count})
        return counts

    @staticmethod
    def _derive_summary_status(counts: List[Dict[str, Any]]) -> str:
        for entry in counts:
            if entry["label"] in {"failed", "error", "errors"}:
                return "error"
        return "success"

    @staticmethod
    def _extract_duration(summary_line: str) -> Optional[float]:
        match = re.search(r"in\s+([0-9]+(?:\.[0-9]+)?)s", summary_line)
        if not match:
            return None
        try:
            return float(match.group(1))
        except ValueError:
            return None

    @staticmethod
    def _extract_collected_count(lines: List[str]) -> Optional[int]:
        for line in lines:
            match = re.match(r"collected\s+(\d+)\s+items?", line, re.IGNORECASE)
            if not match:
                continue
            try:
                return int(match.group(1))
            except ValueError:
                return None
        return None

    @staticmethod
    def _truncate_output(text: str) -> str:
        trimmed = text.strip()
        if len(trimmed) <= 20000:
            return trimmed
        return trimmed[-20000:]

    def _build_test_command(self, repo_path: str) -> List[str]:
        """Build the test command with appropriate ignore patterns.

        Args:
            repo_path: Path to the repository

        Returns:
            List of command arguments
        """
        cmd = list(self.run_tests_cmd)

        # Only add ignore patterns if using pytest
        if not cmd or cmd[0] != "pytest":
            return cmd

        # Add ignore patterns using --ignore-glob (pytest 6.0+)
        # This matches directories anywhere in the tree
        for pattern in self.ignore_patterns:
            cmd.extend(["--ignore-glob", f"**/{pattern}"])

        return cmd

    def _execute_coverage_run(self, repo_path: str) -> "Coverage._RunContext":
        logger.info("Running coverage on %s", repo_path)
        cmd = ["coverage", "run", "-m", *self._build_test_command(repo_path)]
        start_time = time.perf_counter()
        timeout_kwargs: Dict[str, Any] = {}
        if self.timeout is not None:
            timeout_kwargs["timeout"] = self.timeout

        timed_out = False
        try:
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                cwd=repo_path,
                **timeout_kwargs,
            )
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            process = SimpleNamespace(
                returncode=-1,
                stdout=(
                    (
                        exc.stdout.decode()
                        if isinstance(exc.stdout, bytes)
                        else exc.stdout
                    )
                    if exc.stdout
                    else None
                ),
                stderr=(
                    (
                        exc.stderr.decode()
                        if isinstance(exc.stderr, bytes)
                        else exc.stderr
                    )
                    if exc.stderr
                    else None
                ),
            )
        duration = time.perf_counter() - start_time

        pytest_details = self._parse_pytest_output(process.stdout)
        pytest_summary: Optional[Dict[str, Any]] = None
        embedded_results: List[Dict[str, Any]] = []
        if pytest_details:
            pytest_summary = dict(pytest_details)
            pytest_summary.pop("raw_output", None)
            embedded_results.append(
                {
                    "tool": "pytest",
                    "status": pytest_details.get("status", "unknown"),
                    "duration": pytest_details.get("duration") or duration,
                    "output": pytest_details,
                }
            )

        return self._RunContext(
            returncode=process.returncode,
            duration=duration,
            stdout=process.stdout,
            stderr=process.stderr,
            pytest_details=pytest_details,
            pytest_summary=pytest_summary,
            embedded_results=embedded_results,
            timed_out=timed_out,
        )

    def _generate_coverage_xml(self) -> "Coverage._XmlContext":
        cmd = ["coverage", "xml"]
        start_time = time.perf_counter()
        timeout_kwargs: Dict[str, Any] = {}
        if self.xml_timeout is not None:
            timeout_kwargs["timeout"] = self.xml_timeout

        timed_out = False
        try:
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                **timeout_kwargs,
            )
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            process = SimpleNamespace(
                returncode=-1,
                stdout=(
                    (
                        exc.stdout.decode()
                        if isinstance(exc.stdout, bytes)
                        else exc.stdout
                    )
                    if exc.stdout
                    else None
                ),
                stderr=(
                    (
                        exc.stderr.decode()
                        if isinstance(exc.stderr, bytes)
                        else exc.stderr
                    )
                    if exc.stderr
                    else None
                ),
            )
        duration = time.perf_counter() - start_time

        return self._XmlContext(
            returncode=process.returncode,
            duration=duration,
            stdout=process.stdout,
            stderr=process.stderr,
            timed_out=timed_out,
        )

    def _load_coverage_report(
        self, repo_path: str
    ) -> Tuple[float, List[Dict[str, Any]]]:
        coverage_xml_path = os.path.join(repo_path, "coverage.xml")
        if not os.path.exists(coverage_xml_path):
            raise FileNotFoundError("Coverage XML file not found")

        tree = ET.parse(coverage_xml_path)
        root = tree.getroot()

        coverage_pct = float(root.get("line-rate", "0")) * 100
        files_coverage = []
        for class_elem in root.findall(".//class"):
            filename = class_elem.get("filename", "unknown")
            line_rate = float(class_elem.get("line-rate", "0")) * 100
            files_coverage.append({"filename": filename, "coverage": line_rate})

        return coverage_pct, files_coverage

    def _build_test_failure_result(
        self, run_ctx: "Coverage._RunContext"
    ) -> Dict[str, Any]:
        if run_ctx.returncode == 5:
            logger.info("No tests collected (return code 5)")
            skipped_result: Dict[str, Any] = {
                "status": "skipped",
                "error": "No tests collected",
                "stdout": run_ctx.stdout,
                "stderr": run_ctx.stderr,
                "duration": run_ctx.duration,
            }
            self._apply_pytest_metadata(skipped_result, run_ctx)
            return skipped_result

        logger.error("Test run failed with return code %s", run_ctx.returncode)
        if getattr(run_ctx, "timed_out", False):
            base_message = (
                f"Coverage test run timed out after {self.timeout} seconds"
                if self.timeout
                else "Coverage test run timed out"
            )
            if run_ctx.stderr:
                message = f"{base_message}: {run_ctx.stderr}"
            else:
                message = base_message
        else:
            message = f"Test run failed with return code {run_ctx.returncode}"

        error_result: Dict[str, Any] = {
            "status": "error",
            "error": message,
            "stdout": run_ctx.stdout,
            "stderr": run_ctx.stderr,
            "duration": run_ctx.duration,
        }
        self._apply_pytest_metadata(error_result, run_ctx)
        return error_result

    def _build_xml_failure_result(
        self,
        run_ctx: "Coverage._RunContext",
        xml_ctx: "Coverage._XmlContext",
    ) -> Dict[str, Any]:
        logger.error(
            "Coverage XML generation failed with return code %s",
            xml_ctx.returncode,
        )
        if getattr(xml_ctx, "timed_out", False):
            base_message = (
                f"Coverage XML generation timed out after {self.xml_timeout} seconds"
                if self.xml_timeout
                else "Coverage XML generation timed out"
            )
            if xml_ctx.stderr:
                message = f"{base_message}: {xml_ctx.stderr}"
            else:
                message = base_message
        else:
            message = (
                "Coverage XML generation failed with return code "
                f"{xml_ctx.returncode}"
            )

        error_result: Dict[str, Any] = {
            "status": "error",
            "error": message,
            "stdout": xml_ctx.stdout,
            "stderr": xml_ctx.stderr,
            "duration": run_ctx.duration + xml_ctx.duration,
        }
        self._apply_pytest_metadata(error_result, run_ctx)
        return error_result

    def _build_success_result(
        self,
        coverage_pct: float,
        files_coverage: List[Dict[str, Any]],
        duration: float,
        run_ctx: "Coverage._RunContext",
    ) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "status": "success",
            "percentage": coverage_pct,
            "files": files_coverage,
            "duration": duration,
        }
        self._apply_pytest_metadata(result, run_ctx)
        return result

    @staticmethod
    def _apply_pytest_metadata(
        payload: Dict[str, Any], run_ctx: "Coverage._RunContext"
    ) -> None:
        if run_ctx.pytest_summary:
            payload["pytest_summary"] = run_ctx.pytest_summary
        if run_ctx.embedded_results:
            payload["embedded_results"] = run_ctx.embedded_results


class Lizard(Tool):  # pylint: disable=too-few-public-methods
    """Cyclomatic complexity analysis via the Lizard tool."""

    def __init__(self, max_ccn: int = 10, *, timeout: Optional[float] = None):
        """Initialize Lizard.

        Args:
            max_ccn: Maximum cyclomatic complexity threshold
            timeout: Timeout in seconds for lizard execution
        """
        super().__init__("lizard")
        self.max_ccn = max_ccn
        self.timeout = timeout if timeout is not None else DEFAULT_LIZARD_TIMEOUT

    def run(self, repo_path: str) -> Dict[str, Any]:
        return self._run_via_cli_per_file(repo_path)

    def _run_via_cli_per_file(self, repo_path: str) -> Dict[str, Any]:
        start_time = time.perf_counter()
        files = self._discover_python_files(repo_path)
        functions: List[Dict[str, Any]] = []
        timed_out: List[str] = []
        failed: List[str] = []
        errors: List[str] = []

        for file_path in _progress(files, desc="lizard", unit="file"):
            try:
                process = subprocess.run(
                    ["lizard", "--xml", file_path],
                    capture_output=True,
                    text=True,
                    check=False,
                    cwd=repo_path,
                    timeout=self.timeout,
                )
            except subprocess.TimeoutExpired:
                logger.error("Lizard timed out on %s", file_path)
                timed_out.append(file_path)
                errors.append(f"Lizard timed out on {file_path}")
                continue
            except FileNotFoundError:
                message = (
                    "Lizard executable not found. Install 'lizard' to enable CCN scanning."
                )
                logger.error(message)
                return {"status": "error", "error": message}
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Error launching lizard CLI for %s", file_path)
                failed.append(file_path)
                errors.append(f"Error launching lizard CLI for {file_path}: {exc}")
                continue

            if process.returncode != 0:
                logger.error("Lizard CLI failed on %s", file_path)
                failed.append(file_path)
                errors.append(f"Lizard CLI failed on {file_path}")
                continue

            try:
                functions.extend(self._parse_xml_output(repo_path, process.stdout))
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Failed to parse Lizard XML output for %s", file_path)
                failed.append(file_path)
                errors.append(
                    f"Failed to parse Lizard XML output for {file_path}: {exc}"
                )

        duration = time.perf_counter() - start_time
        result = self._build_result(functions, duration)
        if timed_out:
            result["timed_out_files"] = timed_out
        if failed:
            result["failed_files"] = failed
        if errors:
            result["status"] = "error"
            result["error"] = "; ".join(errors[:5])
        return result

    def _discover_python_files(self, repo_path: str) -> List[str]:
        ignore_dirs = set(self._sanitize_ignore_dirs())
        files: List[str] = []
        for root, dirs, filenames in os.walk(repo_path):
            dirs[:] = [name for name in dirs if name not in ignore_dirs]
            for filename in filenames:
                if filename.endswith(".py"):
                    files.append(os.path.join(root, filename))
        return sorted(set(files))

    @staticmethod
    def _sanitize_ignore_dirs() -> List[str]:
        ignore_dirs: List[str] = []
        for pattern in DEFAULT_PYLINT_IGNORE_DIRS:
            if not pattern:
                continue
            if "*" in pattern:
                continue
            ignore_dirs.append(pattern.strip("/"))
        return ignore_dirs

    def _run_via_cli(self, repo_path: str) -> Dict[str, Any]:
        start_time = time.perf_counter()
        try:
            process = subprocess.run(
                ["lizard", "--xml", "."],
                capture_output=True,
                text=True,
                check=False,
                cwd=repo_path,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired:
            logger.error("Lizard timed out after %s seconds", self.timeout)
            return {
                "status": "error",
                "error": f"Lizard timed out after {self.timeout} seconds",
                "timed_out": True,
            }
        except FileNotFoundError:
            message = (
                "Lizard executable not found. Install 'lizard' to enable CCN scanning."
            )
            logger.error(message)
            return {"status": "error", "error": message}
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Error launching lizard CLI")
            return {"status": "error", "error": str(exc)}

        duration = time.perf_counter() - start_time

        if process.returncode != 0:
            logger.error("Lizard CLI failed with return code %s", process.returncode)
            return {
                "status": "error",
                "error": f"Lizard CLI returned {process.returncode}",
                "stdout": process.stdout,
                "stderr": process.stderr,
                "duration": duration,
            }

        try:
            functions = self._parse_xml_output(repo_path, process.stdout)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Failed to parse Lizard XML output")
            return {
                "status": "error",
                "error": f"Failed to parse Lizard XML output: {exc}",
                "stdout": process.stdout,
                "stderr": process.stderr,
                "duration": duration,
            }

        return self._build_result(functions, duration)

    def _collect_module_functions(
        self, repo_path: str, file_infos: List[Any]
    ) -> List[Dict[str, Any]]:
        functions: List[Dict[str, Any]] = []
        for file_info in file_infos:
            filename = getattr(file_info, "filename", None)
            if not filename:
                continue

            rel_filename = self._normalize_path(repo_path, filename)

            for func in getattr(file_info, "function_list", []) or []:
                ccn = getattr(func, "cyclomatic_complexity", None)
                if ccn is None:
                    continue

                functions.append(
                    {
                        "name": getattr(func, "long_name", getattr(func, "name", None)),
                        "filename": rel_filename,
                        "line": getattr(func, "start_line", None),
                        "ccn": float(ccn),
                        "nloc": getattr(func, "nloc", None),
                    }
                )

        return functions

    def _parse_xml_output(self, repo_path: str, xml_text: str) -> List[Dict[str, Any]]:
        measure = self._xml_function_measure(xml_text)
        if measure is None:
            return []

        labels = self._xml_measure_labels(measure)
        functions: List[Dict[str, Any]] = []
        for item in measure.findall("item"):
            parsed = self._parse_xml_function_item(repo_path, item, labels)
            if parsed is not None:
                functions.append(parsed)
        return functions

    @staticmethod
    def _xml_function_measure(xml_text: str) -> Optional[ET.Element]:
        if not xml_text or not xml_text.strip():
            return None

        root = ET.fromstring(xml_text)
        return root.find(".//measure[@type='Function']")

    @staticmethod
    def _xml_measure_labels(measure: ET.Element) -> List[str]:
        label_elements = measure.find("labels")
        labels = label_elements.findall("label") if label_elements is not None else []
        return [(label.text or "").strip() for label in labels]

    @staticmethod
    def _safe_float(value: Optional[str]) -> Optional[float]:
        if not value:
            return None
        try:
            return float(value)
        except ValueError:
            return None

    @staticmethod
    def _safe_int(value: Optional[str]) -> Optional[int]:
        if not value:
            return None
        try:
            return int(float(value))
        except ValueError:
            return None

    def _parse_xml_function_item(
        self, repo_path: str, item: ET.Element, labels: List[str]
    ) -> Optional[Dict[str, Any]]:
        values = [
            value.text.strip() if value.text else "" for value in item.findall("value")
        ]
        metrics = dict(zip(labels, values))

        name_attr = item.get("name", "")
        func_name, filename, line = self._extract_location_from_cli_name(
            repo_path, name_attr
        )

        ccn_value = metrics.get("CCN") or metrics.get("Ccn")
        nloc_value = metrics.get("NCSS") or metrics.get("Ncss")

        ccn = self._safe_float(ccn_value)
        if ccn is None:
            return None

        return {
            "name": func_name,
            "filename": filename,
            "line": line,
            "ccn": ccn,
            "nloc": self._safe_int(nloc_value),
        }

    def _build_result(
        self, functions: List[Dict[str, Any]], duration: float
    ) -> Dict[str, Any]:
        ccn_values = self._ccn_values(functions)
        offenders = self._lizard_offenders(functions)

        result: Dict[str, Any] = {
            "status": "success",
            "summary": self._lizard_summary(functions, ccn_values, offenders),
            "duration": duration,
        }

        top_offenders = self._top_offenders(offenders)
        if top_offenders:
            result["top_offenders"] = top_offenders

        return result

    @staticmethod
    def _ccn_values(functions: List[Dict[str, Any]]) -> List[float]:
        return [
            float(entry["ccn"]) for entry in functions if entry.get("ccn") is not None
        ]

    def _lizard_offenders(
        self, functions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        offenders = [
            entry
            for entry in functions
            if entry.get("ccn") is not None and float(entry["ccn"]) > self.max_ccn
        ]
        offenders.sort(key=lambda item: item.get("ccn") or 0.0, reverse=True)
        return offenders

    def _lizard_summary(
        self,
        functions: List[Dict[str, Any]],
        ccn_values: List[float],
        offenders: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        average_ccn = float(sum(ccn_values) / len(ccn_values)) if ccn_values else 0.0
        max_ccn = max(ccn_values) if ccn_values else 0.0

        return {
            "total_functions": len(functions),
            "files_analyzed": len(
                {f["filename"] for f in functions if f.get("filename")}
            ),
            "average_ccn": average_ccn,
            "max_ccn": max_ccn,
            "threshold": self.max_ccn,
            "above_threshold": len(offenders),
        }

    @staticmethod
    def _top_offenders(offenders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {
                "name": offender.get("name"),
                "filename": offender.get("filename"),
                "line": offender.get("line"),
                "ccn": offender.get("ccn"),
                "nloc": offender.get("nloc"),
            }
            for offender in offenders[:10]
        ]

    def _extract_location_from_cli_name(
        self, repo_path: str, cli_name: str
    ) -> Tuple[Optional[str], Optional[str], Optional[int]]:
        func_name = None
        filename = None
        line_number: Optional[int] = None

        if " at " in cli_name:
            name_part, _, location = cli_name.partition(" at ")
            func_name = name_part or None
            if ":" in location:
                path_part, _, line_part = location.rpartition(":")
                filename = self._normalize_path(repo_path, path_part)
                try:
                    line_number = int(line_part)
                except (TypeError, ValueError):
                    line_number = None
            else:
                filename = self._normalize_path(repo_path, location)
        else:
            func_name = cli_name or None

        return func_name, filename, line_number

    @staticmethod
    def _normalize_path(repo_path: str, filename: str) -> str:
        try:
            base_path = os.path.abspath(repo_path)
            relative = os.path.relpath(filename, base_path)
        except (ValueError, OSError):
            relative = filename
        return relative


class Jscpd(Tool):  # pylint: disable=too-few-public-methods
    """Duplicate code detection using jscpd (copy-paste detector)."""

    def __init__(
        self,
        min_lines: int = 5,
        min_tokens: int = 50,
        threshold: float = 0.0,
        ignore: Optional[List[str]] = None,
        *,
        timeout: Optional[float] = None,
    ):
        """Initialize jscpd.

        Args:
            min_lines: Minimum lines in a clone block (default 5)
            min_tokens: Minimum tokens in a clone block (default 50)
            threshold: Maximum allowed duplication percentage (default 0.0 = report only)
            ignore: List of glob patterns to ignore
            timeout: Timeout in seconds for jscpd execution
        """
        super().__init__("jscpd")
        self.min_lines = min_lines
        self.min_tokens = min_tokens
        self.threshold = threshold
        self.ignore = ignore or ["**/node_modules/**", "**/.git/**", "**/venv/**", "**/__pycache__/**"]
        self.timeout = timeout if timeout is not None else DEFAULT_JSCPD_TIMEOUT

    def run(self, repo_path: str) -> Dict[str, Any]:
        """Run jscpd duplicate detection.

        Args:
            repo_path: Path to the repository

        Returns:
            Duplicate detection results
        """
        start_time = time.perf_counter()

        # Build command
        cmd = [
            "jscpd",
            "--reporters", "json",
            "--min-lines", str(self.min_lines),
            "--min-tokens", str(self.min_tokens),
            "--output", ".",
        ]

        for pattern in self.ignore:
            cmd.extend(["--ignore", pattern])

        cmd.append(".")

        try:
            process = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                cwd=repo_path,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired:
            logger.error("jscpd timed out after %s seconds", self.timeout)
            return {
                "status": "error",
                "error": f"jscpd timed out after {self.timeout} seconds",
                "timed_out": True,
            }
        except FileNotFoundError:
            message = (
                "jscpd not found. Install via 'npm install -g jscpd' to enable "
                "duplicate code detection."
            )
            logger.error(message)
            return {"status": "error", "error": message}
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Error running jscpd")
            return {"status": "error", "error": str(exc)}

        duration = time.perf_counter() - start_time

        # Parse JSON output
        json_path = os.path.join(repo_path, "jscpd-report.json")
        if not os.path.exists(json_path):
            # Try alternate location
            json_path = os.path.join(repo_path, "report", "jscpd-report.json")

        if not os.path.exists(json_path):
            logger.warning("jscpd JSON report not found, parsing stdout")
            return self._parse_stdout(process, duration)

        try:
            with open(json_path, "r", encoding="utf-8") as handle:
                report = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("Failed to parse jscpd JSON report: %s", exc)
            return {
                "status": "error",
                "error": f"Failed to parse jscpd report: {exc}",
                "duration": duration,
            }
        finally:
            # Clean up report file
            try:
                os.remove(json_path)
            except OSError:
                pass

        return self._build_result(report, duration)

    def _parse_stdout(
        self, process: subprocess.CompletedProcess, duration: float
    ) -> Dict[str, Any]:
        """Fallback parser for stdout when JSON report is unavailable."""
        if process.returncode != 0 and not process.stdout:
            return {
                "status": "error",
                "error": f"jscpd failed with return code {process.returncode}",
                "stderr": process.stderr,
                "duration": duration,
            }

        # Return basic success with no duplicates found
        return {
            "status": "success",
            "summary": {
                "total_lines": 0,
                "total_tokens": 0,
                "duplicated_lines": 0,
                "duplicated_tokens": 0,
                "percentage": 0.0,
                "files_analyzed": 0,
                "clones_found": 0,
            },
            "duplicates": [],
            "duration": duration,
        }

    def _build_result(
        self, report: Dict[str, Any], duration: float
    ) -> Dict[str, Any]:
        """Build result from jscpd JSON report."""
        statistics = report.get("statistics", {})
        total = statistics.get("total", {})
        duplications = report.get("duplicates", [])

        percentage = total.get("percentage", 0.0)
        if isinstance(percentage, str):
            percentage = float(percentage.rstrip("%"))

        summary = {
            "total_lines": total.get("lines", 0),
            "total_tokens": total.get("tokens", 0),
            "duplicated_lines": total.get("duplicatedLines", 0),
            "duplicated_tokens": total.get("duplicatedTokens", 0),
            "percentage": percentage,
            "files_analyzed": total.get("sources", 0),
            "clones_found": len(duplications),
        }

        # Format duplicates for output
        formatted_duplicates = []
        for dup in duplications[:20]:  # Limit to top 20
            first_file = dup.get("firstFile", {})
            second_file = dup.get("secondFile", {})
            formatted_duplicates.append({
                "lines": dup.get("lines", 0),
                "tokens": dup.get("tokens", 0),
                "first": {
                    "file": first_file.get("name", "unknown"),
                    "start": first_file.get("start", 0),
                    "end": first_file.get("end", 0),
                },
                "second": {
                    "file": second_file.get("name", "unknown"),
                    "start": second_file.get("start", 0),
                    "end": second_file.get("end", 0),
                },
                "fragment": dup.get("fragment", "")[:500],  # Truncate large fragments
            })

        status = "success"
        if self.threshold > 0 and percentage > self.threshold:
            status = "warning"

        return {
            "status": status,
            "summary": summary,
            "duplicates": formatted_duplicates,
            "duration": duration,
        }


class ToolRunner:
    """Runner for multiple tools."""

    def __init__(self, tools: Optional[List[Tool]] = None):
        """Initialize the tool runner.

        Args:
            tools: List of tools to run
        """
        self.tools = tools or []

    def add_tool(self, tool: Tool):
        """Add a tool to the runner.

        Args:
            tool: Tool to add
        """
        self.tools.append(tool)

    def run_all(self, repo_path: str) -> Dict[str, Dict[str, Any]]:
        """Run all tools.

        Args:
            repo_path: Path to the repository

        Returns:
            Dictionary with results from all tools
        """
        results = {}
        for tool in self.tools:
            results[tool.name] = tool.run(repo_path)
        return results
