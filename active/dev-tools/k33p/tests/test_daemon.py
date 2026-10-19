"""Tests for the k33p auto-commit daemon."""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

import pytest

from k33p.daemon import Daemon, FileChange, _parse_duration, run_daemon
from k33p.project import load_project
from k33p.store import ContentStore

# ── helpers ──────────────────────────────────────────────────────────────


@pytest.fixture
def project_with_daemon() -> Path:
    """Create a project with auto_commit enabled."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "k33p.yaml").write_text("""\
project: daemon-test
type: single
channels:
  src:
    type: source
    transport: file:///tmp/nonexistent
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
daemon:
  auto_commit:
    enabled: true
    debounce: 2s
    paths: ["."]
    ignore:
      - "*.tmp"
      - "*.swp"
    message: "auto: {files}"
""")
        # Init the store
        store_path = root / ".k33p" / "store"
        store_path.mkdir(parents=True, exist_ok=True)
        yield root


@pytest.fixture
def project_without_daemon() -> Path:
    """Create a project without auto_commit."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "k33p.yaml").write_text("""\
project: no-daemon
type: single
channels:
  src:
    type: source
    transport: file:///tmp/nonexistent
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
        yield root


# ── _parse_duration ──────────────────────────────────────────────────────


class TestParseDuration:
    def test_seconds(self) -> None:
        assert _parse_duration("30s") == 30

    def test_minutes(self) -> None:
        assert _parse_duration("5m") == 300

    def test_hours(self) -> None:
        assert _parse_duration("1h") == 3600

    def test_hours_and_minutes(self) -> None:
        assert _parse_duration("2h30m") == 9000

    def test_plain_number(self) -> None:
        assert _parse_duration("60") == 60

    def test_invalid_default(self) -> None:
        assert _parse_duration("invalid") == 300  # default


# ── Daemon configuration ─────────────────────────────────────────────────


class TestDaemonConfig:
    def test_auto_commit_config_present(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        ac = daemon.auto_commit_config
        assert ac is not None
        assert ac.enabled is True

    def test_auto_commit_config_absent(self, project_without_daemon: Path) -> None:
        project = load_project(str(project_without_daemon))
        daemon = Daemon(project)
        assert daemon.auto_commit_config is None

    def test_watched_paths(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        paths = daemon.watched_paths
        assert len(paths) == 1
        assert paths[0] == project_with_daemon.resolve()

    def test_debounce_seconds(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        assert daemon.debounce_seconds == 2

    def test_ignore_patterns(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        assert "*.tmp" in daemon.ignore_patterns
        assert "*.swp" in daemon.ignore_patterns

    def test_message_template(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        assert "{files}" in daemon.message_template()


# ── file scanning ────────────────────────────────────────────────────────


class TestFileScanning:
    def test_scan_initial(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        files = daemon._scan_files()
        # Should include k33p.yaml
        assert "k33p.yaml" in files

    def test_scan_ignores_k33p_dir(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        files = daemon._scan_files()
        # .k33p should not be in the results
        assert not any(f.startswith(".k33p") for f in files)

    def test_scan_ignores_git_dir(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        # Create a .git directory to test it's ignored
        (project_with_daemon / ".git" / "objects").mkdir(parents=True, exist_ok=True)
        (project_with_daemon / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
        files = daemon._scan_files()
        assert not any(f.startswith(".git") for f in files)

    def test_scan_detects_new_file(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        # Prime the scan (initial scan sees all files as "new")
        daemon._detect_changes()
        changes = daemon._detect_changes()
        # After priming, no changes yet
        assert len(changes) == 0

        # Create a new file
        (project_with_daemon / "newfile.txt").write_text("hello")
        changes = daemon._detect_changes()
        assert len(changes) >= 1
        assert any("newfile.txt" in c.path for c in changes)

    def test_scan_ignores_tmp_files(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        daemon._detect_changes()  # prime the scan
        # Create a .tmp file (should be ignored by pattern)
        (project_with_daemon / "test.tmp").write_text("temp")
        changes = daemon._detect_changes()
        assert not any("test.tmp" in c.path for c in changes)


# ── commit creation ──────────────────────────────────────────────────────


class TestCommitCreation:
    def test_build_tree_from_files(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        (project_with_daemon / "hello.txt").write_text("hello world")
        # Scan files
        files = daemon._scan_files()
        tree_hash = daemon._build_tree(files)
        assert tree_hash is not None
        # Verify the tree object exists in the store
        store_path = project_with_daemon / ".k33p" / "store"
        store = ContentStore(store_path)
        assert store.has(tree_hash)
        assert store.get_kind(tree_hash) == "tree"

    def test_create_commit(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        (project_with_daemon / "hello.txt").write_text("hello world")
        files = daemon._scan_files()
        tree_hash = daemon._build_tree(files)
        assert tree_hash is not None
        commit_hash = daemon._create_commit(tree_hash, ["hello.txt"])
        assert commit_hash is not None
        # Verify commit in store
        store_path = project_with_daemon / ".k33p" / "store"
        store = ContentStore(store_path)
        assert store.has(commit_hash)
        assert store.get_kind(commit_hash) == "commit"

    def test_commit_with_parent(self, project_with_daemon: Path) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        (project_with_daemon / "a.txt").write_text("a")
        files = daemon._scan_files()
        tree_hash = daemon._build_tree(files)
        c1 = daemon._create_commit(tree_hash, ["a.txt"])
        assert c1 is not None
        # Second commit should have the first as parent
        (project_with_daemon / "b.txt").write_text("b")
        files2 = daemon._scan_files()
        tree_hash2 = daemon._build_tree(files2)
        c2 = daemon._create_commit(tree_hash2, ["b.txt"])
        assert c2 is not None
        # The commit content should reference the parent
        commit_data = ContentStore(project_with_daemon / ".k33p" / "store").get(c2)
        assert commit_data is not None
        assert c1[:16].encode() in commit_data  # parent hash in commit content


# ── run_daemon ───────────────────────────────────────────────────────────


class TestRunDaemon:
    def test_run_once_no_changes(self, project_with_daemon: Path) -> None:
        rc = run_daemon(str(project_with_daemon), once=True)
        assert rc == 0

    def test_run_once_with_changes(self, project_with_daemon: Path) -> None:
        (project_with_daemon / "test.txt").write_text("content")
        rc = run_daemon(str(project_with_daemon), once=True)
        assert rc == 0
        # Should have created a commit
        store_path = project_with_daemon / ".k33p" / "store"
        store = ContentStore(store_path)
        # At least one commit should exist
        commits = [o for o in store.iter_objects() if o.kind == "commit"]
        assert len(commits) >= 1

    def test_run_without_daemon_config(self, project_without_daemon: Path) -> None:
        rc = run_daemon(str(project_without_daemon), once=True)
        assert rc == 1  # auto_commit not enabled

    def test_run_nonexistent_path(self) -> None:
        rc = run_daemon("/nonexistent", once=True)
        assert rc == 1

# ── artifact snapshotting (gitignored files kept in the CAS, not git) ───

class TestArtifactSnapshot:
    """Gitignored files are content-addressed into the store, not git."""

    @staticmethod
    def _fake_gitignore(paths: list[str]) -> set[str]:
        """Stand-in for ``git check-ignore``: ignore everything under backup/."""
        return {p for p in paths if p.startswith("backup/")}

    def test_scan_partitions_source_and_artifacts(
        self, project_with_daemon: Path, monkeypatch
    ) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        monkeypatch.setattr(daemon, "_filter_gitignored", self._fake_gitignore)

        (project_with_daemon / "backup").mkdir()
        (project_with_daemon / "backup" / "save.kicad_pcb.bak").write_text("snapshot")
        (project_with_daemon / "src.kicad_pcb").write_text("board")

        source = daemon._scan_files()
        artifacts = daemon._scan_artifact_files()
        assert "src.kicad_pcb" in source
        assert "k33p.yaml" in source
        assert "backup/save.kicad_pcb.bak" in artifacts
        assert "backup/save.kicad_pcb.bak" not in source

    def test_commit_records_artifact_tree(
        self, project_with_daemon: Path, monkeypatch
    ) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        monkeypatch.setattr(daemon, "_filter_gitignored", self._fake_gitignore)

        (project_with_daemon / "backup").mkdir()
        (project_with_daemon / "backup" / "save.bak").write_text("snapshot-data")
        (project_with_daemon / "hello.txt").write_text("hello")

        daemon.run(once=True)

        store_path = project_with_daemon / ".k33p" / "store"
        store = ContentStore(store_path)
        commits = [o for o in store.iter_objects() if o.kind == "commit"]
        assert len(commits) >= 1
        commit_data = store.get(commits[-1].hash)
        assert commit_data is not None
        assert b"artifacts " in commit_data

        # The artifact tree points at a blob stored with kind="artifact"
        artifact_line = next(
            line for line in commit_data.decode().splitlines()
            if line.startswith("artifacts ")
        )
        art_tree_hash = artifact_line.split()[1]
        assert store.get_kind(art_tree_hash) == "tree"
        tree_data = store.get(art_tree_hash)
        assert tree_data is not None
        assert b"artifact backup/save.bak" in tree_data
        blob_hash = tree_data.decode().split("artifact backup/save.bak\0")[1].split("\n")[0]
        assert store.get_kind(blob_hash) == "artifact"

    def test_artifact_only_change_triggers_snapshot(
        self, project_with_daemon: Path, monkeypatch
    ) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        monkeypatch.setattr(daemon, "_filter_gitignored", self._fake_gitignore)

        (project_with_daemon / "backup").mkdir()
        daemon._detect_changes()          # prime source scan
        daemon._detect_artifact_changes()  # prime artifact scan

        # Only an artifact changes — should still produce a snapshot commit
        (project_with_daemon / "backup" / "new.bak").write_text("new")
        changes = daemon._detect_artifact_changes()
        assert any("backup/new.bak" in c.path for c in changes)
        assert daemon._detect_changes() == []  # no source changes

        daemon.state.pending_changes.extend(changes)
        daemon._do_commit()
        store = ContentStore(project_with_daemon / ".k33p" / "store")
        commits = [o for o in store.iter_objects() if o.kind == "commit"]
        assert len(commits) >= 1
        commit_data = store.get(commits[-1].hash)
        assert commit_data is not None and b"artifacts " in commit_data

    def test_no_artifacts_no_artifacts_line(
        self, project_with_daemon: Path, monkeypatch
    ) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        # Nothing is gitignored in the fixture
        daemon._filter_gitignored = lambda paths: set()  # type: ignore[method-assign]

        (project_with_daemon / "hello.txt").write_text("hello")
        daemon.run(once=True)

        store = ContentStore(project_with_daemon / ".k33p" / "store")
        commits = [o for o in store.iter_objects() if o.kind == "commit"]
        assert len(commits) >= 1
        commit_data = store.get(commits[-1].hash)
        assert commit_data is not None
        assert b"artifacts " not in commit_data


# ── git auto-push hardening ─────────────────────────────────────────────

class TestGitPushRecovery:
    def test_git_add_stages_new_files_with_all(self, project_with_daemon: Path, monkeypatch) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        daemon.state.pending_changes = [FileChange(path="newfile.txt", mtime=time.time())]

        calls: list[list[str]] = []

        def fake_run(args, **kwargs):
            calls.append(list(args))
            if args[:3] == ["git", "diff", "--name-only"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "ls-files", "--others", "--exclude-standard"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "add", "--all"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "diff", "--cached", "--quiet"]:
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="")
            if args[:2] == ["git", "commit"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "rev-parse", "--abbrev-ref"]:
                return subprocess.CompletedProcess(args, 0, stdout="main\n", stderr="")
            if args[:2] == ["git", "push"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            raise AssertionError(f"unexpected git command: {args}")

        monkeypatch.setattr(subprocess, "run", fake_run)
        rc = daemon._do_git_push("https://git.example.com/repo.git")
        assert rc == 1
        add_call = next(cmd for cmd in calls if cmd[:2] == ["git", "add"])
        assert add_call[:4] == ["git", "add", "--all", "--"]

    def test_untracked_only_changes_are_committed(self, project_with_daemon: Path, monkeypatch) -> None:
        """Regression: a host with only brand-new (untracked) files must still get
        a commit even though ``git diff`` cannot see untracked files."""
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        commits: list[list[str]] = []

        def fake_run(args, **kwargs):
            commits.append(list(args))
            if args[:3] == ["git", "diff", "--name-only"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "ls-files", "--others", "--exclude-standard"]:
                return subprocess.CompletedProcess(args, 0, stdout="brand/new_file.txt\n", stderr="")
            if args[:3] == ["git", "add", "--all"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "diff", "--cached", "--quiet"]:
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="")
            if args[:2] == ["git", "commit"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "rev-parse", "--abbrev-ref"]:
                return subprocess.CompletedProcess(args, 0, stdout="main\n", stderr="")
            if args[:2] == ["git", "push"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            raise AssertionError(f"unexpected git command: {args}")

        monkeypatch.setattr(subprocess, "run", fake_run)
        rc = daemon._do_git_push("https://git.example.com/repo.git")
        assert rc == 1
        commit_call = next(cmd for cmd in commits if cmd[:2] == ["git", "commit"])
        assert any("brand/new_file.txt" in c for c in commit_call)

    def test_push_recovers_from_non_fast_forward(self, project_with_daemon: Path, monkeypatch) -> None:
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        daemon.state.pending_changes = [FileChange(path="file.txt", mtime=time.time())]

        calls: list[list[str]] = []
        push_count = {"n": 0}

        def fake_run(args, **kwargs):
            calls.append(list(args))
            if args[:3] == ["git", "diff", "--name-only"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "ls-files", "--others", "--exclude-standard"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:2] == ["git", "add"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "diff", "--cached", "--quiet"]:
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="")
            if args[:2] == ["git", "commit"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "rev-parse", "--abbrev-ref"]:
                return subprocess.CompletedProcess(args, 0, stdout="main\n", stderr="")
            if args[:2] == ["git", "push"]:
                push_count["n"] += 1
                if push_count["n"] == 1:
                    return subprocess.CompletedProcess(args, 1, stdout="", stderr="! [rejected] main -> main (non-fast-forward)")
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:2] == ["git", "fetch"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:2] == ["git", "rebase"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            raise AssertionError(f"unexpected git command: {args}")

        monkeypatch.setattr(subprocess, "run", fake_run)
        rc = daemon._do_git_push("https://git.example.com/repo.git")
        assert rc == 1
        assert ["git", "fetch", "origin", "main"] in calls
        assert ["git", "rebase", "origin/main"] in calls
        assert push_count["n"] == 2

    def test_conflicting_rebase_reports_files_and_aborts(
        self, project_with_daemon: Path, monkeypatch, capsys
    ) -> None:
        """A rebase that conflicts must name the conflicted files and abort cleanly,
        so a diverged host is diagnosable from the journal instead of looping."""
        project = load_project(str(project_with_daemon))
        daemon = Daemon(project)
        daemon.state.pending_changes = [FileChange(path="file.txt", mtime=time.time())]

        calls: list[list[str]] = []

        def fake_run(args, **kwargs):
            calls.append(list(args))
            if args[:4] == ["git", "diff", "--name-only", "--relative"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "diff", "--name-only", "--diff-filter=U"]:
                return subprocess.CompletedProcess(
                    args, 0, stdout="launcher/apps.yaml\nscripts/check_all.py\n", stderr=""
                )
            if args[:4] == ["git", "ls-files", "--others", "--exclude-standard"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:2] == ["git", "add"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:4] == ["git", "diff", "--cached", "--quiet"]:
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="")
            if args[:2] == ["git", "commit"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "rev-parse", "--abbrev-ref"]:
                return subprocess.CompletedProcess(args, 0, stdout="main\n", stderr="")
            if args[:2] == ["git", "push"]:
                return subprocess.CompletedProcess(
                    args, 1, stdout="", stderr="! [rejected] main -> main (non-fast-forward)"
                )
            if args[:2] == ["git", "fetch"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:3] == ["git", "rebase", "--abort"]:
                return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
            if args[:2] == ["git", "rebase"]:
                return subprocess.CompletedProcess(
                    args, 1, stdout="", stderr="Rebasing (1/58)\nerror: could not apply abc123"
                )
            raise AssertionError(f"unexpected git command: {args}")

        monkeypatch.setattr(subprocess, "run", fake_run)
        rc = daemon._do_git_push("https://git.example.com/repo.git")

        assert rc == 1
        assert ["git", "rebase", "--abort"] in calls
        out = capsys.readouterr().out
        assert "hit conflicts" in out
        assert "launcher/apps.yaml, scripts/check_all.py" in out
        assert "manual reconcile needed" in out
