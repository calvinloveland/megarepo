"""Tests for the CI service."""

import json
import os
import queue
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import yaml

from src.service import CIService


class TestCIService(unittest.TestCase):
    """Test cases for CIService."""

    def _call_private(self, method_name: str, *args, **kwargs):
        """Call a private CIService helper by name for focused unit tests."""
        return getattr(self.service, method_name)(*args, **kwargs)

    def setUp(self):
        """Set up test fixtures."""
        # Create a temporary database
        self.temp_db_fd, self.temp_db_path = tempfile.mkstemp()
        self._dogfood_env = os.environ.get("FULL_AUTO_CI_DOGFOOD")
        os.environ["FULL_AUTO_CI_DOGFOOD"] = "0"
        self.service = CIService(db_path=self.temp_db_path)
        self.service.git_tracker.add_repository = MagicMock(return_value=True)
        self.service.git_tracker.remove_repository = MagicMock(return_value=True)

    def tearDown(self):
        """Tear down test fixtures."""
        if self._dogfood_env is None:
            os.environ.pop("FULL_AUTO_CI_DOGFOOD", None)
        else:
            os.environ["FULL_AUTO_CI_DOGFOOD"] = self._dogfood_env
        os.close(self.temp_db_fd)
        os.unlink(self.temp_db_path)

    def test_init(self):
        """Test initialization."""
        self.assertEqual(self.service.db_path, self.temp_db_path)
        self.assertFalse(self.service.running)

    def test_tool_runner_respects_config(self):
        """Tool runner should honor enabled/disabled tool configuration."""
        cfg_fd, cfg_path = tempfile.mkstemp(suffix=".yml")
        os.close(cfg_fd)
        config_data = {
            "tools": {
                "pylint": {"enabled": False},
                "ruff": {"enabled": False},
                "coverage": {"enabled": False},
                "lizard": {"enabled": True, "max_ccn": 7},
            }
        }

        with open(cfg_path, "w", encoding="utf-8") as handle:
            yaml.safe_dump(config_data, handle)

        try:
            service = CIService(config_path=cfg_path, db_path=self.temp_db_path)
            tool_names = [tool.name for tool in service.tool_runner.tools]
            self.assertNotIn("pylint", tool_names)
            self.assertNotIn("ruff", tool_names)
            self.assertNotIn("coverage", tool_names)
            self.assertIn("lizard", tool_names)

            lizard_tool = next(
                tool for tool in service.tool_runner.tools if tool.name == "lizard"
            )
            self.assertEqual(lizard_tool.max_ccn, 7)
        finally:
            os.unlink(cfg_path)

    def test_tool_runner_configures_coverage_timeouts(self):
        """Coverage tool should adopt configured command and timeout values."""
        cfg_fd, cfg_path = tempfile.mkstemp(suffix=".yml")
        os.close(cfg_fd)
        config_data = {
            "tools": {
                "pylint": {"enabled": False},
                "ruff": {"enabled": False},
                "coverage": {
                    "enabled": True,
                    "run_tests_cmd": ["pytest", "-k", "slow"],
                    "timeout_seconds": 12,
                    "xml_timeout_seconds": "3.5",
                    "auto_install_missing_dependencies": False,
                    "max_dependency_install_attempts": 4,
                    "dependency_install_timeout_seconds": 9,
                },
                "lizard": {"enabled": False},
            }
        }

        with open(cfg_path, "w", encoding="utf-8") as handle:
            yaml.safe_dump(config_data, handle)

        try:
            service = CIService(config_path=cfg_path, db_path=self.temp_db_path)
            tools = service.tool_runner.tools
            self.assertEqual(len(tools), 1)
            coverage_tool = tools[0]
            self.assertEqual(coverage_tool.run_tests_cmd, ["pytest", "-k", "slow"])
            self.assertEqual(coverage_tool.timeout, 12.0)
            self.assertEqual(coverage_tool.xml_timeout, 3.5)
            self.assertFalse(coverage_tool.auto_install_missing_dependencies)
            self.assertEqual(coverage_tool.max_dependency_install_attempts, 4)
            self.assertEqual(coverage_tool.dependency_install_timeout, 9.0)
        finally:
            os.unlink(cfg_path)

    def test_add_repository(self):
        """Test adding a repository."""
        repo_id = self.service.add_repository(
            "test", "https://github.com/test/test.git"
        )
        self.assertGreater(repo_id, 0)

        # Verify that the repository was added
        repo = self.service.get_repository(repo_id)
        self.assertIsNotNone(repo)
        self.assertEqual(repo["name"], "test")
        self.assertEqual(repo["url"], "https://github.com/test/test.git")
        self.assertEqual(repo["branch"], "main")

    def test_remove_repository(self):
        """Test removing a repository."""
        repo_id = self.service.add_repository(
            "test", "https://github.com/test/test.git"
        )
        success = self.service.remove_repository(repo_id)
        self.assertTrue(success)

        # Verify that the repository was removed
        repo = self.service.get_repository(repo_id)
        self.assertIsNone(repo)

    def test_list_repositories(self):
        """Test listing repositories."""
        # Add some repositories
        repo1_id = self.service.add_repository(
            "test1", "https://github.com/test/test1.git"
        )
        repo2_id = self.service.add_repository(
            "test2", "https://github.com/test/test2.git"
        )

        # List repositories
        repos = self.service.list_repositories()
        self.assertEqual(len(repos), 2)

        # Verify repository details
        repo1 = next((r for r in repos if r["id"] == repo1_id), None)
        self.assertIsNotNone(repo1)
        self.assertEqual(repo1["name"], "test1")

        repo2 = next((r for r in repos if r["id"] == repo2_id), None)
        self.assertIsNotNone(repo2)
        self.assertEqual(repo2["name"], "test2")

    def test_create_user_and_list(self):
        """Users can be created and enumerated."""
        user_id = self.service.create_user(
            "alice", "s3cret", role="admin", api_key="apikey"
        )
        self.assertGreater(user_id, 0)

        users = self.service.list_users()
        self.assertEqual(len(users), 1)
        self.assertEqual(users[0]["username"], "alice")
        self.assertEqual(users[0]["role"], "admin")

        conn = sqlite3.connect(self.service.db_path)
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT password_hash, api_key_hash FROM users WHERE username = ?",
                ("alice",),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        self.assertIsNotNone(row)
        password_hash, api_key_hash = row
        self.assertNotEqual(password_hash, "s3cret")
        self.assertEqual(len(password_hash), 64)
        self.assertNotEqual(api_key_hash, "apikey")
        self.assertEqual(len(api_key_hash), 64)

    def test_remove_user(self):
        """Users can be removed."""
        self.service.create_user("bob", "pw")
        success = self.service.remove_user("bob")
        self.assertTrue(success)

        users = self.service.list_users()
        self.assertEqual(users, [])

        self.assertFalse(self.service.remove_user("bob"))

    @patch("threading.Thread")
    def test_start_stop(self, mock_thread):
        """Test starting and stopping the service."""
        # Mock the thread to avoid actually running it
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        # Start the service
        self.service.start()
        self.assertTrue(self.service.running)
        expected_threads = (self.service.config.get("service", "max_workers") or 4) + 1
        self.assertEqual(mock_thread.call_count, expected_threads)
        self.assertEqual(mock_thread_instance.start.call_count, expected_threads)

        # Stop the service
        self.service.stop()
        self.assertFalse(self.service.running)
        self.assertTrue(mock_thread_instance.join.called)

    @patch("threading.Thread")
    def test_start_marks_interrupted_runs_as_error(self, mock_thread):
        """Service startup should reconcile stale active runs left in the database."""
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        repo_id = self.service.add_repository(
            "demo", "https://github.com/test/demo.git"
        )
        running_run_id = self.service.data.create_test_run(
            repo_id, "deadbeef", "running", 100
        )
        self.service.data.update_test_run(
            running_run_id, status="running", started_at=120
        )
        queued_run_id = self.service.data.create_test_run(
            repo_id, "cafebabe", "queued", 101
        )
        self.service.data.update_test_run(queued_run_id, status="queued")

        self.service.start()

        active_runs = self.service.data.list_test_runs_by_status(["queued", "running"])
        self.assertEqual(active_runs, [])

        all_runs = self.service.data.fetch_recent_test_runs(repo_id, limit=10)
        run_by_id = {run["id"]: run for run in all_runs}
        self.assertEqual(run_by_id[running_run_id]["status"], "error")
        self.assertEqual(run_by_id[queued_run_id]["status"], "error")
        self.assertEqual(
            run_by_id[running_run_id]["error"],
            CIService.INTERRUPTED_RUNNING_MESSAGE,
        )
        self.assertEqual(
            run_by_id[queued_run_id]["error"],
            CIService.INTERRUPTED_QUEUED_MESSAGE,
        )

    @patch("src.service.CIService._create_test_run")
    @patch("src.service.CIService._summarize_tool_results")
    @patch("src.service.CIService._update_test_run")
    @patch("src.git.GitTracker.get_repository")
    def test_run_tests(
        self,
        mock_get_repo,
        mock_update_run,
        mock_summarize,
        mock_create_run,
    ):
        """Test running tests synchronously via run_tests."""

        mock_repo = MagicMock()
        mock_repo.repo_path = "/tmp/repo"
        mock_repo.clone.return_value = True
        mock_repo.checkout_commit.return_value = True
        mock_get_repo.return_value = mock_repo

        mock_create_run.return_value = 42
        mock_summarize.return_value = ("success", None)

        with patch("src.service.CIService._store_results") as mock_store, patch(
            "src.service.os.path.exists", return_value=True
        ), patch.object(self.service, "tool_runner") as mock_tool_runner:
            mock_tool_runner.run_all.return_value = {
                "pylint": {"status": "success"},
                "coverage": {"status": "success"},
                "lizard": {"status": "success"},
            }

            result = self.service.run_tests(1, "abcdef")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["test_run_id"], 42)
        self.assertIn("pylint", result["tools"])
        self.assertIn("coverage", result["tools"])
        self.assertIn("lizard", result["tools"])
        mock_update_run.assert_any_call(42, "running")
        mock_update_run.assert_any_call(42, "completed")
        mock_store.assert_called_once()

    def test_get_test_results_hydrates_commit_and_results(self):
        """get_test_results should include commit and parsed tool results."""
        repo_id = self.service.add_repository("demo", "https://example.com/demo.git")

        commit_hash = "deadbeef"
        commit_id = self.service.data.create_commit(
            repo_id,
            commit_hash,
            author="Dev",
            message="Refactor",
            timestamp=1234,
        )

        run_id = self.service.data.create_test_run(
            repo_id, commit_hash, "completed", 1200
        )
        self.service.data.update_test_run(
            run_id, status="completed", completed_at=1300, started_at=1250
        )
        self.service.data.insert_result(
            commit_id,
            tool="pylint",
            status="success",
            output=json.dumps({"status": "success", "score": 9.5}),
            duration=0.5,
        )

        runs = self.service.get_test_results(repo_id)
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual(run["id"], run_id)
        self.assertEqual(run["commit_hash"], commit_hash)
        self.assertEqual(run["commit"]["hash"], commit_hash)
        self.assertEqual(run["commit"]["message"], "Refactor")
        self.assertEqual(len(run["results"]), 1)
        self.assertEqual(run["results"][0]["tool"], "pylint")

    @patch("src.service.CIService._has_local_changes", return_value=True)
    @patch("src.service.CIService._create_test_run", return_value=99)
    @patch("src.service.CIService._store_results")
    @patch(
        "src.service.CIService._summarize_tool_results", return_value=("success", None)
    )
    @patch("src.service.CIService._update_test_run")
    @patch("src.git.GitTracker.get_repository")
    def test_run_tests_warns_when_source_dirty(
        self,
        mock_get_repo,
        _mock_update_run,
        _mock_summarize,
        _mock_store,
        _mock_create_run,
        mock_dirty,
    ):
        """run_tests should emit warnings when local source has pending changes."""
        mock_repo = MagicMock()
        mock_repo.repo_path = "/tmp/repo"
        mock_repo.clone.return_value = True
        mock_repo.checkout_commit.return_value = True
        mock_repo.url = "/source"
        mock_get_repo.return_value = mock_repo

        with patch("src.service.os.path.exists", return_value=True), patch.object(
            self.service, "tool_runner"
        ) as mock_runner:
            mock_runner.run_all.return_value = {
                "pylint": {"status": "success"},
                "lizard": {"status": "success"},
            }
            result = self.service.run_tests(1, "abcdef")

        self.assertIn("warnings", result)
        self.assertTrue(result["warnings"])
        mock_dirty.assert_called_once_with("/source")

    def test_summarize_tool_results_reports_errors(self):
        """Tool summary should aggregate failing tool names into the message."""
        results = {
            "pylint": {"status": "success"},
            "coverage": {
                "status": "error",
                "stderr": "coverage failed",
            },
            "pytest": {
                "status": "error",
                "error": "tests failed",
            },
        }
        (
            status,
            message,
        ) = self._call_private("_summarize_tool_results", results)
        self.assertEqual(status, "error")
        self.assertIn("coverage", message)
        self.assertIn("pytest", message)

    def test_add_provider_creates_record(self):
        """Adding a provider should create and list a persisted record."""
        provider = self.service.add_provider(
            "github",
            "GitHub Demo",
            config={"token": "abc", "owner": "me", "repository": "demo"},
        )
        self.assertEqual(provider["name"], "GitHub Demo")
        self.assertGreater(provider["id"], 0)

        providers = self.service.list_providers()
        self.assertEqual(len(providers), 1)
        self.assertEqual(providers[0]["type"], "github")
        self.assertEqual(providers[0]["name"], "GitHub Demo")

    def test_remove_provider(self):
        """Removing a provider should delete it from provider listings."""
        self.service.add_provider(
            "github",
            "GitHub Demo",
            config={"token": "abc", "owner": "me", "repository": "demo"},
        )
        providers = self.service.list_providers()
        self.assertEqual(len(providers), 1)

        removed = self.service.remove_provider(providers[0]["id"])
        self.assertTrue(removed)
        self.assertEqual(self.service.list_providers(), [])

    def test_get_provider_types(self):
        """Provider type registry should include built-in integrations."""
        types = self.service.get_provider_types()
        # At least github, gitlab, jenkins, bamboo should be present
        registered = {entry["type"] for entry in types}
        self.assertIn("github", registered)
        self.assertIn("gitlab", registered)

    def test_coerce_bool_variants(self):
        """_coerce_bool should normalize common truthy and falsy values."""
        self.assertTrue(self._call_private("_coerce_bool", True))
        self.assertFalse(self._call_private("_coerce_bool", False))
        self.assertTrue(self._call_private("_coerce_bool", "yes"))
        self.assertFalse(self._call_private("_coerce_bool", "0"))
        self.assertTrue(self._call_private("_coerce_bool", 1))
        self.assertFalse(self._call_private("_coerce_bool", 0))

    @patch("src.service.os.path.isdir", return_value=False)
    def test_has_local_changes_nonexistent(self, mock_isdir):
        """Missing directories should be treated as having no local changes."""
        self.assertFalse(self._call_private("_has_local_changes", "/missing"))
        mock_isdir.assert_called_once_with("/missing")

    @patch("src.service.subprocess.run")
    @patch("src.service.os.path.isdir", return_value=True)
    def test_has_local_changes_detects_output(self, mock_isdir, mock_run):
        """Non-empty git status output should count as local changes."""
        mock_result = MagicMock()
        mock_result.stdout = " M file.txt\n"
        mock_run.return_value = mock_result

        self.assertTrue(self._call_private("_has_local_changes", "/repo"))
        mock_isdir.assert_called_once_with("/repo")
        mock_run.assert_called_once()

    def test_tool_runner_helper_normalizers(self):
        self.assertTrue(self._call_private("_tool_enabled", {}, True))
        self.assertFalse(self._call_private("_tool_enabled", {"enabled": False}, True))
        self.assertFalse(self._call_private("_tool_enabled", "bad", False))
        self.assertEqual(self._call_private("_normalize_run_tests_cmd", {"run_tests_cmd": ["pytest", "-q"]}), ["pytest", "-q"])
        self.assertEqual(self._call_private("_normalize_run_tests_cmd", {"run_tests_cmd": "pytest -q"}), ["pytest -q"])
        self.assertIsNone(self._call_private("_normalize_run_tests_cmd", "bad"))
        self.assertIsNone(self._call_private("_normalize_run_tests_cmd", {"run_tests_cmd": 3}))
        self.assertEqual(self._call_private("_coerce_positive_float", 5), 5.0)
        self.assertEqual(self._call_private("_coerce_positive_float", " 3.5 "), 3.5)
        self.assertIsNone(self._call_private("_coerce_positive_float", "bad"))
        self.assertIsNone(self._call_private("_coerce_positive_float", 0))
        self.assertIsNone(self._call_private("_normalize_ignore_patterns", None))
        self.assertEqual(self._call_private("_normalize_ignore_patterns", ["a", "b"]), ["a", "b"])
        self.assertIsNone(self._call_private("_normalize_ignore_patterns", ["a", 1]))

    def test_component_override_helpers(self):
        original = self.service.tool_runner
        replacement = MagicMock()
        self.service.tool_runner = replacement
        self.assertIs(self.service.tool_runner, replacement)
        del self.service.tool_runner
        self.assertIs(self.service.tool_runner, original)

        original_data = self.service.data
        replacement_data = MagicMock()
        self.service.data = replacement_data
        self.assertIs(self.service.data, replacement_data)
        del self.service.data
        self.assertIs(self.service.data, original_data)

    def test_provider_and_dogfood_helpers(self):
        self.service.provider_registry = MagicMock()
        self.service.provider_registry.create.side_effect = KeyError("missing")
        self.assertIsNone(self._call_private("_instantiate_provider", {"id": 1, "type": "missing"}))

        self.service.provider_registry.create.side_effect = None
        from src.providers import ProviderConfigError

        self.service.provider_registry.create.side_effect = ProviderConfigError("bad config")
        self.assertIsNone(self._call_private("_instantiate_provider", {"id": 1, "type": "github"}))

        provider = SimpleNamespace(provider_id=7, display_name="GitHub", description="desc", to_dict=lambda: {"id": 7})
        self.service.provider_registry.create.side_effect = None
        self.service.provider_registry.create.return_value = provider
        self.service.data.list_external_providers = MagicMock(return_value=[{"id": 7, "name": "GH", "type": "github", "config": {}}])
        self.service._load_providers()
        listed = self.service.list_providers()
        self.assertEqual(listed[0]["display_name"], "GitHub")
        self.service.provider_registry.create.return_value = None
        self.service.data.list_external_providers = MagicMock(return_value=[{"id": 8, "name": "Skip", "type": "github", "config": {}}])
        self.service._load_providers()
        self.assertEqual(self.service._providers, {})

        provider_cls = SimpleNamespace(display_name="Fallback", description="fallback desc")
        self.service._providers.clear()
        self.service.provider_registry.get = MagicMock(return_value=provider_cls)
        listed = self.service.list_providers()
        self.assertEqual(listed[0]["display_name"], "Fallback")
        self.service.provider_registry.get = MagicMock(side_effect=KeyError("missing"))
        listed = self.service.list_providers()
        self.assertNotIn("display_name", listed[0])

        self.assertEqual(self._call_private("_resolve_dogfood_repo_info", {}), {
            "url": "https://github.com/calvinloveland/full-auto-ci.git",
            "name": "Full Auto CI",
            "branch": "main",
        })
        self.assertFalse(self._call_private("_dogfood_enabled", {"enabled": False}))
        with patch.dict(os.environ, {"FULL_AUTO_CI_DOGFOOD": "1"}, clear=False):
            self.assertTrue(self._call_private("_dogfood_enabled", {"enabled": False}))
        self.assertTrue(self._call_private("_should_queue_dogfood_run", {}))
        with patch.dict(os.environ, {"FULL_AUTO_CI_DOGFOOD_QUEUE": "0"}, clear=False):
            self.assertFalse(self._call_private("_should_queue_dogfood_run", {}))

    def test_dogfood_repository_and_commit_helpers(self):
        self.service.list_repositories = MagicMock(return_value=[{"id": 5, "url": "https://example.com/repo.git"}])
        self.assertEqual(
            self._call_private("_ensure_dogfood_repository", {"url": "https://example.com/repo.git", "name": "Repo", "branch": "main"}),
            5,
        )
        self.service.list_repositories = MagicMock(return_value=[])
        self.service.add_repository = MagicMock(return_value=0)
        self.assertIsNone(
            self._call_private("_ensure_dogfood_repository", {"url": "https://example.com/repo.git", "name": "Repo", "branch": "main"})
        )
        self.service.add_repository = MagicMock(return_value=6)
        self.assertEqual(
            self._call_private("_ensure_dogfood_repository", {"url": "https://example.com/other.git", "name": "Repo", "branch": "main"}),
            6,
        )

        repo = MagicMock()
        repo.get_latest_commit.return_value = None
        repo.pull.return_value = False
        self.service.git_tracker.get_repository = MagicMock(return_value=repo)
        self.assertIsNone(self._call_private("_resolve_latest_dogfood_commit", 5))

        repo.pull.return_value = True
        repo.get_latest_commit.side_effect = [None, {"hash": "abc"}]
        self.assertEqual(self._call_private("_resolve_latest_dogfood_commit", 5), {"hash": "abc"})

    def test_queue_and_test_run_helpers(self):
        self.service.data.get_latest_test_run = MagicMock(return_value=(3, "running"))
        self.assertEqual(self._call_private("_create_or_get_pending_test_run", 1, "abc"), (3, True))
        self.service.data.get_latest_test_run = MagicMock(return_value=None)
        self.service._create_test_run = MagicMock(return_value=9)
        self.assertEqual(self._call_private("_create_or_get_pending_test_run", 1, "abc"), (9, False))

        self.service.get_repository = MagicMock(return_value=None)
        self.assertFalse(self._call_private("_enqueue_commit", 1, "abc"))
        self.service.get_repository = MagicMock(return_value={"id": 1})
        self.service._get_commit_record = MagicMock(return_value={"hash": "abc"})
        self.service._create_or_get_pending_test_run = MagicMock(return_value=(2, True))
        self.assertTrue(self._call_private("_enqueue_commit", 1, "abc"))
        self.service._create_or_get_pending_test_run = MagicMock(return_value=(2, False))
        self.service._update_test_run = MagicMock()
        self.assertTrue(self._call_private("_enqueue_commit", 1, "abc"))
        task = self.service.task_queue.get_nowait()
        self.assertEqual(task["type"], "test")
        del self.service._get_commit_record

        self.service.data.fetch_commit = MagicMock(return_value=None)
        self.assertEqual(self._call_private("_get_commit_record", 1, "abc"), {"repository_id": 1, "hash": "abc"})
        self.service.data.fetch_commit = MagicMock(return_value={"author": "Dev", "message": "Msg", "timestamp": 10})
        commit = self._call_private("_get_commit_record", 1, "abc")
        self.assertEqual(commit["author"], "Dev")
        self.assertIn("datetime", commit)

    def test_working_tree_and_storage_helpers(self):
        self.assertEqual(self._call_private("_resolve_local_repo_path", ""), None)
        self.assertEqual(self._call_private("_resolve_local_repo_path", "https://example.com/repo.git"), None)
        self.assertEqual(self._call_private("_resolve_local_repo_path", "file:///tmp/demo"), "/tmp/demo")
        self.assertEqual(self._call_private("_resolve_local_repo_path", "/tmp/demo"), "/tmp/demo")

        self.assertEqual(self._call_private("_resolve_working_tree_inclusion", "", include_working_tree=True), (True, None))
        with patch("src.service.os.path.isdir", return_value=False):
            self.assertEqual(
                self._call_private("_resolve_working_tree_inclusion", "/tmp/demo", include_working_tree=False),
                (False, "/tmp/demo"),
            )
        with patch("src.service.os.path.isdir", return_value=True), patch(
            "src.service.CIService._has_local_changes", return_value=True
        ):
            self.assertEqual(
                self._call_private("_resolve_working_tree_inclusion", "/tmp/demo", include_working_tree=False),
                (True, "/tmp/demo"),
            )

        self.assertIsNone(self._call_private("_maybe_prepare_repo_for_run", MagicMock(), 1, "abc", 3, include_working_tree=True))
        self._call_private("_cleanup_working_snapshot", None)

        self.assertEqual(
            self._call_private("_prepare_working_tree_run", 1, "abc", "https://example.com/repo.git", None, include_working_tree=False),
            ("abc", None, None),
        )
        error = self._call_private("_prepare_working_tree_run", 1, "abc", "https://example.com/repo.git", None, include_working_tree=True)
        self.assertEqual(error["status"], "error")

        self.service.data.get_commit_id = MagicMock(return_value=7)
        self.assertEqual(self._call_private("_ensure_commit_id", 1, "abc"), 7)
        self.service.data.get_commit_id = MagicMock(return_value=None)
        self.service.data.create_commit = MagicMock(return_value=8)
        self.assertEqual(self._call_private("_ensure_commit_id", 1, "abc"), 8)

        self.assertIsNone(self._call_private("_coerce_embedded_result", None))
        self.assertIsNone(self._call_private("_coerce_embedded_result", {}))
        embedded = self._call_private("_coerce_embedded_result", {"tool": "pytest", "status": "success", "output": {"ok": True}, "duration": "1.5"})
        self.assertEqual(embedded["tool"], "pytest")
        self.assertIn("ok", embedded["output"])

    def test_repository_run_and_user_helper_edges(self):
        self.assertFalse(self.service.add_test_task(999, "deadbeef"))
        with self.assertRaises(ValueError):
            self.service.create_user("", "pw")
        with self.assertRaises(ValueError):
            self.service.create_user("alice", "")

        repo = MagicMock()
        repo.repo_path = "/tmp/repo"
        repo.clone.return_value = False
        with patch("src.service.os.path.exists", return_value=False):
            error = self._call_private("_prepare_repo_for_run", repo, 1, "abc", 3)
        self.assertEqual(error["status"], "error")
        repo.clone.return_value = True
        repo.checkout_commit.return_value = False
        with patch("src.service.os.path.exists", return_value=True):
            error = self._call_private("_prepare_repo_for_run", repo, 1, "abc", 3)
        self.assertEqual(error["status"], "error")

        self.assertEqual(self._call_private("_format_run_results", "success", None, {"pylint": {}}, 1, []), {
            "status": "success",
            "tools": {"pylint": {}},
            "test_run_id": 1,
        })

    def test_provider_sync_and_component_helpers(self):
        provider = SimpleNamespace(provider_id=3, sync_runs=MagicMock(return_value=[{"id": 1}]))
        self.service._providers = {3: provider}
        self.assertEqual(self.service.sync_provider(3, limit=2), [{"id": 1}])
        provider.sync_runs.assert_called_once_with(limit=2)

        self.service._providers.clear()
        self.service.data.fetch_external_provider = MagicMock(return_value=None)
        with self.assertRaises(KeyError):
            self.service.sync_provider(9)

        self.service.data.fetch_external_provider = MagicMock(return_value={"id": 9, "type": "github"})
        self.service._instantiate_provider = MagicMock(return_value=None)
        with self.assertRaises(RuntimeError):
            self.service.sync_provider(9)

        self.service._instantiate_provider = MagicMock(return_value=provider)
        self.assertEqual(self.service.sync_provider(9), [{"id": 1}])

        original_git = self.service.git_tracker
        replacement_git = MagicMock()
        self.service.git_tracker = replacement_git
        self.assertIs(self.service.git_tracker, replacement_git)
        del self.service.git_tracker
        self.assertIs(self.service.git_tracker, original_git)

        original_ratchet = self.service.ratchet_manager
        replacement_ratchet = MagicMock()
        self.service.ratchet_manager = replacement_ratchet
        self.assertIs(self.service.ratchet_manager, replacement_ratchet)
        del self.service.ratchet_manager
        self.assertIs(self.service.ratchet_manager, original_ratchet)

    def test_provider_add_and_service_state_helpers(self):
        provider_cls = MagicMock()
        provider_cls.validate_static_config.return_value = ["bad config"]
        self.service.provider_registry.get = MagicMock(return_value=provider_cls)
        from src.providers import ProviderConfigError

        with self.assertRaises(ProviderConfigError):
            self.service.add_provider("github", "Broken", config={})

        provider_cls.validate_static_config.return_value = []
        self.service.data.create_external_provider = MagicMock(return_value=4)
        self.service.data.fetch_external_provider = MagicMock(return_value=None)
        with self.assertRaises(RuntimeError):
            self.service.add_provider("github", "Broken", config={})

        self.service.data.fetch_external_provider = MagicMock(return_value={"id": 4, "type": "github"})
        self.service._instantiate_provider = MagicMock(return_value=None)
        provider = self.service.add_provider("github", "Fallback", config={"token": "x"})
        self.assertEqual(provider["id"], 4)

        self.service.data.update_repository_last_check = MagicMock()
        self._call_private("_update_repository_last_check", 7)
        self.service.data.update_repository_last_check.assert_called_once()

        self.service.data.update_test_run = MagicMock()
        self._call_private("_update_test_run", None, "queued")
        self.service.data.update_test_run.assert_not_called()
        self.assertEqual(self._call_private("_hash_secret", "secret"), self._call_private("_hash_secret", "secret"))

    def test_dogfood_bootstrap_and_commit_helper_paths(self):
        self.service._dogfood_enabled = MagicMock(return_value=False)
        self._call_private("_bootstrap_dogfood_repository")
        self.service._resolve_dogfood_repo_info = MagicMock()
        self.service._ensure_dogfood_repository = MagicMock()
        self.service._dogfood_enabled = MagicMock(return_value=False)
        self.service._resolve_dogfood_repo_info.assert_not_called()

        self.service._dogfood_enabled = MagicMock(return_value=True)
        self.service._resolve_dogfood_repo_info = MagicMock(return_value={"url": "u", "name": "n", "branch": "b"})
        self.service._ensure_dogfood_repository = MagicMock(return_value=0)
        self._call_private("_bootstrap_dogfood_repository")
        self.service._ensure_dogfood_repository.assert_called_once()

        self.service._ensure_dogfood_repository = MagicMock(return_value=1)
        self.service._should_queue_dogfood_run = MagicMock(return_value=False)
        self._call_private("_bootstrap_dogfood_repository")

        self.service._should_queue_dogfood_run = MagicMock(return_value=True)
        self.service._resolve_latest_dogfood_commit = MagicMock(return_value=None)
        self._call_private("_bootstrap_dogfood_repository")

        self.service._resolve_latest_dogfood_commit = MagicMock(return_value={"hash": "abc"})
        self.service._enqueue_commit = MagicMock(return_value=True)
        self._call_private("_bootstrap_dogfood_repository")
        self.service._enqueue_commit.assert_called_with(1, "abc", {"hash": "abc"})
        del self.service._resolve_latest_dogfood_commit

        self.service.git_tracker.get_repository = MagicMock(return_value=None)
        self.assertIsNone(self._call_private("_resolve_latest_dogfood_commit", 5))
        repo = MagicMock()
        repo.get_latest_commit.return_value = {"hash": "abc"}
        self.service.git_tracker.get_repository = MagicMock(return_value=repo)
        self.assertEqual(self._call_private("_resolve_latest_dogfood_commit", 5), {"hash": "abc"})
        repo.get_latest_commit.side_effect = [None, None]
        repo.pull.return_value = True
        self.assertIsNone(self._call_private("_resolve_latest_dogfood_commit", 5))

    @patch("src.service.subprocess.run", side_effect=OSError("boom"))
    @patch("src.service.os.path.isdir", return_value=True)
    def test_has_local_changes_handles_subprocess_errors(self, _mock_isdir, _mock_run):
        self.assertFalse(self._call_private("_has_local_changes", "/repo"))

    @patch("threading.Thread")
    def test_start_stop_guard_paths(self, mock_thread):
        self.service.running = True
        self.service.start()
        mock_thread.assert_not_called()
        self.service.running = False
        self.service.stop()

    def test_process_and_store_result_helpers(self):
        self.service._update_test_run = MagicMock()
        self.service.git_tracker.get_repository = MagicMock(return_value=None)
        self._call_private("_process_test_task", {"repo_id": 1, "commit": {"hash": "abc"}, "test_run_id": 3})
        self.service._update_test_run.assert_called_with(3, "error", "Repository 1 not found")

        repo = MagicMock()
        repo.checkout_commit.return_value = False
        self.service.git_tracker.get_repository = MagicMock(return_value=repo)
        self.service._update_test_run.reset_mock()
        self._call_private("_process_test_task", {"repo_id": 1, "commit": {"hash": "abc"}, "test_run_id": 3})
        self.service._update_test_run.assert_any_call(3, "error", "Failed to checkout commit abc")

        repo.checkout_commit.return_value = True
        repo.repo_path = "/tmp/repo"
        self.service.tool_runner = MagicMock()
        self.service.tool_runner.run_all.side_effect = RuntimeError("boom")
        self.service._update_test_run.reset_mock()
        self._call_private("_process_test_task", {"repo_id": 1, "commit": {"hash": "abc"}, "test_run_id": 3})
        self.service._update_test_run.assert_any_call(3, "error", "boom")

        repo.checkout_commit.return_value = True
        self.service.tool_runner.run_all.side_effect = None
        results = {"pylint": {"status": "success"}}
        self.service.tool_runner.run_all.return_value = results
        self.service.ratchet_manager.apply = MagicMock(side_effect=RuntimeError("ratchet bad"))
        self.service._store_results = MagicMock()
        self.service._update_test_run.reset_mock()
        self._call_private("_process_test_task", {"repo_id": 1, "commit": {"hash": "abc"}, "test_run_id": 3})
        self.assertEqual(results["pylint"]["status"], "error")
        self.assertIn("ratchet bad", results["pylint"]["error"])
        self.service._update_test_run.assert_any_call(
            3, "error", "pylint: Ratchet evaluation failed: ratchet bad"
        )
        del self.service._store_results

        self.service.ratchet_manager.apply = MagicMock(return_value=None)
        success_results = {"pylint": {"status": "success"}}
        self.service.tool_runner.run_all.return_value = success_results
        self.service._update_test_run.reset_mock()
        self._call_private("_process_test_task", {"repo_id": 1, "commit": {"hash": "abc"}, "test_run_id": 3})
        self.service._update_test_run.assert_any_call(3, "completed")

        self.service.data.insert_result = MagicMock()
        self._call_private("_store_tool_result", 1, "pylint", None)
        self.service.data.insert_result.assert_not_called()
        self._call_private("_store_embedded_results", 1, None)
        self._call_private("_store_embedded_results", 1, {})
        self._call_private("_store_embedded_results", 1, "bad")
        self._call_private("_store_embedded_results", 1, ["bad"])
        self.service.data.insert_result.assert_not_called()

        self._call_private(
            "_store_tool_result",
            1,
            "pylint",
            {"status": "success", "duration": 1, "embedded_results": [{"tool": "pytest", "output": "ok"}]},
        )
        self.assertGreaterEqual(self.service.data.insert_result.call_count, 2)

        self.service._ensure_commit_id = MagicMock(return_value=None)
        self._call_private("_store_results", 1, "abc", {"pylint": {"status": "success"}})
        self.service._ensure_commit_id = MagicMock(return_value=5)
        self.service.data.insert_result.reset_mock()
        self._call_private("_store_results", 1, "abc", {"pylint": {"status": "success"}})
        self.service.data.insert_result.assert_called()
        self.service._ensure_commit_id = MagicMock(side_effect=RuntimeError("boom"))
        self._call_private("_store_results", 1, "abc", {"pylint": {"status": "success"}})
        self.assertEqual(
            self._call_private("_coerce_embedded_result", {"tool": "pytest", "output": "raw text"})["output"],
            "raw text",
        )

    def test_working_tree_snapshot_and_execution_helpers(self):
        with patch("src.service.subprocess.run", side_effect=OSError("boom")):
            self.assertIsNone(self._call_private("_resolve_head_commit", "/repo"))
        process = SimpleNamespace(returncode=0, stdout="abc\n")
        with patch("src.service.subprocess.run", return_value=process):
            self.assertEqual(self._call_private("_resolve_head_commit", "/repo"), "abc")

        with tempfile.TemporaryDirectory() as tmpdir:
            repo = os.path.join(tmpdir, "repo")
            os.makedirs(repo)
            with open(os.path.join(repo, "file.txt"), "w", encoding="utf-8") as handle:
                handle.write("data")
            snapshot = self._call_private("_snapshot_working_tree", repo, 1)
            self.assertTrue(os.path.isdir(snapshot))
            self.assertTrue(os.path.exists(os.path.join(snapshot, "file.txt")))
            self._call_private("_cleanup_working_snapshot", snapshot)
            self.assertFalse(os.path.exists(snapshot))

        with patch("src.service.os.path.isdir", return_value=True), patch.object(
            self.service, "_resolve_head_commit", return_value="head"
        ), patch.object(self.service, "_snapshot_working_tree", return_value="/tmp/snap"):
            prepared = self._call_private(
                "_prepare_working_tree_run", 1, "abc", "/tmp/repo", "/tmp/repo", include_working_tree=True
            )
        self.assertEqual(prepared[1], "/tmp/snap")
        with patch("src.service.os.path.isdir", return_value=False):
            prepared = self._call_private(
                "_prepare_working_tree_run", 1, "abc", "/tmp/repo", "/tmp/repo", include_working_tree=True
            )
        self.assertEqual(prepared["error"], "Local repository path not found")

        self.service._update_test_run = MagicMock()
        repo = SimpleNamespace(repo_path="/tmp/repo")
        self.service.tool_runner = MagicMock()
        self.service.tool_runner.run_all.side_effect = RuntimeError("boom")
        result = self._call_private(
            "_execute_tool_run", 1, "abc", repo, test_run_id=3, warnings=[], run_root=None
        )
        self.assertEqual(result["status"], "error")
        self._call_private("_finalize_test_run", test_run_id=3, repo_id=1, commit_hash="abc", overall_status="success", message=None)
        self.service._update_test_run.assert_any_call(3, "completed")
        self._call_private("_finalize_test_run", test_run_id=3, repo_id=1, commit_hash="abc", overall_status="error", message="bad")
        self.service._update_test_run.assert_any_call(3, "error", "bad")
        self.assertEqual(
            self._call_private(
                "_format_run_results", "error", "bad", {"pylint": {}}, 1, []
            )["error"],
            "bad",
        )

    def test_repository_helpers_and_monitor_paths(self):
        self.service.git_tracker.add_repository = MagicMock(return_value=False)
        repo_id = self.service.add_repository("demo", "https://example.com/demo.git")
        self.assertGreater(repo_id, 0)
        self.service.git_tracker.remove_repository = MagicMock(return_value=False)
        self.service.data.delete_repository = MagicMock(return_value=True)
        self.assertTrue(self.service.remove_repository(repo_id))
        self.service.data.fetch_repository = MagicMock(return_value=None)
        self.assertIsNone(self.service.get_repository(999))

        self.service.get_repository = MagicMock(return_value={"id": 1})
        self.service._enqueue_commit = MagicMock(return_value=True)
        self.assertTrue(self.service.add_test_task(1, "deadbeef"))

        self.service.running = True
        self.service.git_tracker.check_for_updates = MagicMock(side_effect=RuntimeError("boom"))
        with patch("src.service.time.sleep", side_effect=[None, self.service.__setattr__("running", False)]):
            self._call_private("_monitor_repositories")

        self.service.running = True
        self.service.git_tracker.check_for_updates = MagicMock(return_value={1: [{"hash": "abc"}]})
        self.service.git_tracker.repos = {1: object()}
        self.service._enqueue_commit = MagicMock(return_value=True)
        self.service._update_repository_last_check = MagicMock()

        def stop_after_first(_seconds):
            self.service.running = False

        with patch("src.service.time.sleep", side_effect=stop_after_first):
            self._call_private("_monitor_repositories")
        self.service._enqueue_commit.assert_called_with(1, "abc", {"hash": "abc"})
        self.service._update_repository_last_check.assert_called_with(1)

        self.service.running = True
        self.service.git_tracker.check_for_updates = MagicMock(side_effect=RuntimeError("boom"))

        def stop_after_error(_seconds):
            self.service.running = False

        with patch("src.service.time.sleep", side_effect=stop_after_error):
            self._call_private("_monitor_repositories")

    def test_worker_loop_and_run_tests_edge_paths(self):
        self.service.running = True
        self.service._runtime.task_queue = MagicMock()

        def get_task(timeout):
            self.service.running = False
            return {"type": "mystery"}

        self.service._runtime.task_queue.get.side_effect = get_task
        self._call_private("_worker_loop")
        self.service._runtime.task_queue.task_done.assert_called_once()

        self.service.running = True
        self.service._runtime.task_queue = MagicMock()

        calls = {"count": 0}

        def get_with_failure(timeout):
            if calls["count"] == 0:
                calls["count"] += 1
                return {"type": "test"}
            self.service.running = False
            raise queue.Empty

        self.service._runtime.task_queue.get.side_effect = get_with_failure
        self.service._process_test_task = MagicMock(side_effect=RuntimeError("boom"))
        self._call_private("_worker_loop")

        self.service.git_tracker.get_repository = MagicMock(return_value=None)
        self.assertEqual(self.service.run_tests(1, "abc")["status"], "error")

        repo = SimpleNamespace(url="/tmp/repo")
        self.service.git_tracker.get_repository = MagicMock(return_value=repo)
        self.service._prepare_working_tree_run = MagicMock(return_value={"status": "error", "error": "bad tree"})
        self.assertEqual(self.service.run_tests(1, "abc")["error"], "bad tree")

        self.service._prepare_working_tree_run = MagicMock(return_value=("abc", None, None))
        self.service._create_test_run = MagicMock(return_value=5)
        self.service._update_test_run = MagicMock()
        self.service._maybe_prepare_repo_for_run = MagicMock(return_value={"status": "error", "error": "early"})
        self.assertEqual(self.service.run_tests(1, "abc")["error"], "early")

    def test_config_construction_edges_and_warning_helpers(self):
        cfg_fd, cfg_path = tempfile.mkstemp(suffix=".yml")
        os.close(cfg_fd)
        config_data = {
            "tools": {
                "pylint": {"enabled": False},
                "ruff": {"enabled": False},
                "coverage": {
                    "enabled": True,
                    "max_dependency_install_attempts": "bad",
                },
                "lizard": {"enabled": True},
                "jscpd": {
                    "enabled": True,
                    "timeout_seconds": "2",
                    "min_lines": 7,
                    "min_tokens": 22,
                    "threshold": 1.5,
                    "ignore": ["node_modules"],
                },
            }
        }
        with open(cfg_path, "w", encoding="utf-8") as handle:
            yaml.safe_dump(config_data, handle)

        try:
            service = CIService(config_path=cfg_path, db_path=self.temp_db_path)
            coverage_tool = next(tool for tool in service.tool_runner.tools if tool.name == "coverage")
            self.assertEqual(coverage_tool.max_dependency_install_attempts, 2)
            lizard_tool = next(tool for tool in service.tool_runner.tools if tool.name == "lizard")
            self.assertEqual(lizard_tool.max_ccn, 10)
            jscpd_tool = next(tool for tool in service.tool_runner.tools if tool.name == "jscpd")
            self.assertEqual(jscpd_tool.min_lines, 7)
            self.assertEqual(jscpd_tool.timeout, 2.0)
        finally:
            os.unlink(cfg_path)

        with patch("src.service.os.getenv", return_value=None):
            self.assertTrue(self._call_private("_dogfood_enabled", {"enabled": True}))

        with patch("src.service.os.path.isdir", return_value=True), patch.object(
            self.service, "_has_local_changes", return_value=False
        ):
            self.assertEqual(
                self._call_private("_resolve_working_tree_inclusion", "/tmp/repo", include_working_tree=False),
                (False, "/tmp/repo"),
            )

        repo = SimpleNamespace(url="/tmp/repo")
        with patch.object(self.service, "_has_local_changes", return_value=False):
            self.assertEqual(self._call_private("_collect_local_change_warnings", repo, 1), [])
        with patch.object(self.service, "_has_local_changes", return_value=True):
            warnings = self._call_private("_collect_local_change_warnings", repo, 1, include_working_tree=True)
        self.assertIn("working tree files are included", warnings[0])

        self.service.data.create_test_run = MagicMock(return_value=77)
        self.assertEqual(self._call_private("_create_test_run", 1, "abc"), 77)


if __name__ == "__main__":
    unittest.main()
