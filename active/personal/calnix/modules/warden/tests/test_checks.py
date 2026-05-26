"""
Tests for Warden health checks.

Run: python -m pytest tests/test_checks.py -v
Run from the warden module directory.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Add parent to sys.path for imports
WARDEN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WARDEN_DIR))


def test_warden_state_imports():
    """Verify warden_state module can be imported."""
    from warden_state import (
        default_state,
        load_state,
        save_state,
        utc_now,
        ensure_state_layout,
        get_hostname,
    )
    assert utc_now() is not None
    assert get_hostname() is not None
    state = default_state()
    assert state["version"] == 1
    assert state["hostname"] == get_hostname()


def test_state_save_and_load():
    """Verify state round-trips correctly."""
    from warden_state import load_state, save_state, default_state

    with tempfile.TemporaryDirectory() as tmpdir:
        state = default_state()
        state["hostname"] = "test-host"
        save_state(state, tmpdir)
        loaded = load_state(tmpdir)
        assert loaded["hostname"] == "test-host"
        assert loaded["version"] == 1


def test_event_log():
    """Verify event logging works."""
    from warden_state import append_event, read_events

    with tempfile.TemporaryDirectory() as tmpdir:
        append_event({"type": "check", "check": "test", "status": "pass"}, tmpdir)
        append_event({"type": "check", "check": "test", "status": "warn"}, tmpdir)
        events = read_events(tail=10, state_dir=tmpdir)
        assert len(events) == 2
        assert events[0]["status"] == "pass"
        assert events[1]["status"] == "warn"


def test_save_and_load_check_result():
    """Verify check result saving and history loading."""
    from warden_state import save_check_result, load_check_history

    with tempfile.TemporaryDirectory() as tmpdir:
        result = {
            "check": "disk-usage",
            "status": "pass",
            "message": "All good",
            "data": {"filesystems": []},
        }
        save_check_result("disk-usage", result, tmpdir)
        save_check_result("disk-usage", {"check": "disk-usage", "status": "warn", "message": "Getting full", "data": {}}, tmpdir)

        history = load_check_history("disk-usage", tail=10, state_dir=tmpdir)
        assert len(history) >= 1
        assert history[-1]["status"] in ("pass", "warn")


def test_disk_usage_check():
    """Verify disk-usage check runs and returns valid JSON."""
    from checks.disk_usage import check_disk_usage

    result = check_disk_usage({})
    assert result["check"] == "disk-usage"
    assert result["status"] in ("pass", "warn", "fail")
    assert "filesystems" in result.get("data", {})
    # Should have at least the root filesystem
    assert any(fs["mount"] == "/" for fs in result["data"]["filesystems"])


def test_memory_check():
    """Verify memory check runs and returns valid JSON."""
    from checks.memory import check_memory

    result = check_memory({})
    assert result["check"] == "memory"
    assert result["status"] in ("pass", "warn", "fail")
    assert "ram" in result.get("data", {})
    assert result["data"]["ram"]["total_kb"] > 0
    assert result["data"]["ram"]["available_kb"] > 0


def test_systemd_health_check():
    """Verify systemd-health check runs and returns valid JSON."""
    from checks.systemd_health import check_systemd_health

    result = check_systemd_health({})
    assert result["check"] == "systemd-health"
    assert "overall_state" in result.get("data", {})
    assert "failed_units" in result.get("data", {})
    assert isinstance(result["data"]["failed_units"], list)


def test_runner_discovery():
    """Verify runner discovers all built-in checks."""
    from runner import discover_checks

    checks = discover_checks()
    assert "disk-usage" in checks
    assert "memory" in checks
    assert "temperature" in checks
    assert "systemd-health" in checks


def test_wardenctl_help():
    """Verify wardenctl can parse help."""
    from wardenctl import build_parser

    parser = build_parser()
    # Test help prints without error
    parser.print_help()


def test_runner_run_all():
    """Verify runner can run all checks (might need /proc access)."""
    from runner import run_all_checks

    with tempfile.TemporaryDirectory() as tmpdir:
        results = run_all_checks(use_subprocess=False, state_dir=tmpdir)
        assert "disk-usage" in results
        assert "memory" in results
        assert "systemd-health" in results
        # All should have valid status
        for name, result in results.items():
            assert result["status"] in ("pass", "warn", "fail"), f"{name}: {result['status']}"
