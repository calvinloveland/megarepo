"""Flask dashboard application for Full Auto CI."""

from __future__ import annotations

import logging
import os
import secrets
import subprocess
import time
from datetime import datetime
from typing import Any, Dict

try:
    from flask import (
        Blueprint,
        Flask,
        abort,
        current_app,
        flash,
        redirect,
        render_template,
        request,
        url_for,
    )
except ImportError as error:
    Blueprint = Flask = Any
    _FLASK_IMPORT_ERROR = error
else:
    _FLASK_IMPORT_ERROR = None

from ..service import CIService

logger = logging.getLogger(__name__)


def _ensure_secret_key(service: CIService) -> str:
    explicit = service.config.get("dashboard", "secret_key")
    env_key = os.getenv("FULL_AUTO_CI_DASHBOARD_SECRET")

    if explicit:
        return str(explicit)
    if env_key:
        return env_key

    generated = secrets.token_hex(16)
    logger.warning("Dashboard secret key not configured; generated ephemeral key")
    return generated


def _timeago(value: int | None) -> str:
    if value is None:
        return "—"

    try:
        timestamp_dt = datetime.fromtimestamp(int(value))
    except (TypeError, ValueError):
        return "—"

    seconds = int((datetime.now() - timestamp_dt).total_seconds())
    if seconds < 60:
        result = "just now"
    else:
        periods = [
            ("minute", 60),
            ("hour", 3600),
            ("day", 86400),
            ("week", 604800),
            ("month", 2592000),
            ("year", 31536000),
        ]

        result = "—"
        for index, (name, duration) in enumerate(periods):
            next_boundary = periods[index + 1][1] if index + 1 < len(periods) else None
            if next_boundary is not None and seconds >= next_boundary:
                continue

            count = max(1, seconds // duration)
            plural = "s" if count != 1 else ""
            result = f"{count} {name}{plural} ago"
            break

    return result


def _status_class(status: str | None) -> str:
    mapping = {
        "pending": "status-pending",
        "queued": "status-queued",
        "running": "status-running",
        "completed": "status-success",
        "success": "status-success",
        "error": "status-error",
        "failed": "status-error",
    }
    return mapping.get((status or "").lower(), "status-unknown")


def _status_color(status: str | None) -> str:
    mapping = {
        "pending": "#facc15",
        "queued": "#facc15",
        "running": "#38bdf8",
        "completed": "#4ade80",
        "success": "#4ade80",
        "error": "#f87171",
        "failed": "#f87171",
    }
    return mapping.get((status or "").lower(), "#94a3b8")


def _format_duration_compact(value: float | int | None) -> str:
    if value is None:
        return "—"

    try:
        total_seconds = max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return "—"

    if total_seconds < 60:
        return f"{total_seconds}s"

    minutes, seconds = divmod(total_seconds, 60)
    if minutes < 60:
        return f"{minutes}m {seconds}s" if seconds else f"{minutes}m"

    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m" if minutes else f"{hours}h"

    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h" if hours else f"{days}d"


def _format_tool_name(name: str) -> str:
    normalized = name.strip().lower()
    if normalized == "ruff":
        return "Ruff"
    if normalized == "jscpd":
        return "JSCPD"
    return normalized.capitalize()


def _format_signed_int(value: int | float | None) -> str:
    if value is None:
        return "—"
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return "—"
    sign = "+" if numeric > 0 else ""
    return f"{sign}{numeric}"


def _summarize_repo(repo: Dict[str, Any], data_access) -> Dict[str, Any]:
    repo_copy = dict(repo)
    summary = data_access.summarize_test_runs(repo["id"])
    recent = data_access.fetch_recent_test_runs(repo["id"], limit=1)
    latest = recent[0] if recent else None

    repo_copy.update(
        {
            "summary": summary,
            "latest_run": latest,
            "latest_status": (latest or {}).get("status"),
            "latest_started_at": (latest or {}).get("started_at"),
        }
    )
    return repo_copy


def _compute_overview_metrics(repositories: list[Dict[str, Any]]) -> Dict[str, Any]:
    passing_statuses = {"completed", "success"}
    failing_statuses = {"error", "failed"}
    queued_statuses = {"pending", "queued"}
    running_statuses = {"running"}

    metrics = {
        "total": len(repositories),
        "passing": 0,
        "failing": 0,
        "running": 0,
        "queued": 0,
        "never": 0,
    }

    for repo in repositories:
        status = (repo.get("latest_status") or "").lower()
        if not status:
            metrics["never"] += 1
            continue
        if status in passing_statuses:
            metrics["passing"] += 1
        elif status in failing_statuses:
            metrics["failing"] += 1
        elif status in running_statuses:
            metrics["running"] += 1
        elif status in queued_statuses:
            metrics["queued"] += 1
        else:
            metrics["never"] += 1

    return metrics


def _hydrate_test_runs(data_access, runs):
    hydrated = []
    for run in runs:
        commit = data_access.fetch_commit_for_test_run(run["id"])
        results = data_access.fetch_results_for_test_run(run["id"])
        hydrated.append(
            {
                **run,
                "commit": commit,
                "results": results,
            }
        )
    return hydrated


def _compute_duration(run: Dict[str, Any]) -> float | None:
    started_at = run.get("started_at")
    completed_at = run.get("completed_at")
    if started_at is not None and completed_at is not None:
        try:
            return max(0.0, float(completed_at) - float(started_at))
        except (TypeError, ValueError):
            return None
    return None


def _build_trend_points(runs: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    points: list[Dict[str, Any]] = []
    ordered = sorted(
        runs,
        key=lambda item: (item.get("created_at") or 0, item.get("id") or 0),
    )
    for run in ordered:
        commit = run.get("commit") or {}
        label_source = commit.get("hash") or run.get("commit_hash") or "?"
        label = str(label_source)[:7]
        duration = _compute_duration(run)
        points.append(
            {
                "label": label,
                "status": run.get("status", "unknown"),
                "duration": duration,
                "created_at": run.get("created_at"),
            }
        )
    return points


def _build_commit_comparison(runs: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    comparison: list[Dict[str, Any]] = []
    for run in runs:
        commit = run.get("commit") or {}
        label_source = commit.get("hash") or run.get("commit_hash") or "?"
        tools = []
        for result in run.get("results") or []:
            tools.append(
                {
                    "tool": result.get("tool"),
                    "status": result.get("status"),
                }
            )
        comparison.append(
            {
                "commit_hash": str(label_source),
                "status": run.get("status"),
                "duration": _compute_duration(run),
                "tools": tools,
                "message": commit.get("message"),
            }
        )
    return comparison


def _git_numstat_for_commit(repo_path: str, commit_hash: str) -> Dict[str, int] | None:
    if not repo_path or not os.path.exists(repo_path):
        return None

    try:
        result = subprocess.run(
            ["git", "show", "--numstat", "--format=", commit_hash],
            cwd=repo_path,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        logger.exception("Unable to compute LOC stats for commit %s", commit_hash)
        return None

    added = 0
    deleted = 0
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        raw_added, raw_deleted = parts[0], parts[1]
        if raw_added.isdigit():
            added += int(raw_added)
        if raw_deleted.isdigit():
            deleted += int(raw_deleted)

    return {
        "added": added,
        "deleted": deleted,
        "net": added - deleted,
    }


def _build_loc_change_points(
    repo_path: str | None, runs: list[Dict[str, Any]]
) -> list[Dict[str, Any]]:
    if not repo_path:
        return []

    points: list[Dict[str, Any]] = []
    ordered = sorted(
        runs,
        key=lambda item: (item.get("created_at") or 0, item.get("id") or 0),
    )
    for run in ordered:
        commit = run.get("commit") or {}
        commit_hash = str(commit.get("hash") or run.get("commit_hash") or "")
        if not commit_hash:
            continue

        stats = _git_numstat_for_commit(repo_path, commit_hash)
        if stats is None:
            continue

        points.append(
            {
                "label": commit_hash[:7],
                "status": run.get("status", "unknown"),
                "created_at": run.get("created_at"),
                **stats,
            }
        )
    return points


def _enabled_tool_names(service: CIService) -> list[str]:
    names: list[str] = []
    for tool in service.tool_runner.tools:
        name = getattr(tool, "name", None)
        if isinstance(name, str) and name and name not in names:
            names.append(name)
    return names


def _average_tool_durations(
    data_access, repo_id: int, tool_names: list[str]
) -> dict[str, float]:
    averages: dict[str, float] = {}
    for tool_name in tool_names:
        history = data_access.fetch_tool_history(repo_id, tool_name, limit=12)
        durations: list[float] = []
        for entry in history:
            duration = entry.get("duration")
            if isinstance(duration, (int, float)) and duration > 0:
                durations.append(float(duration))
        if durations:
            averages[tool_name] = sum(durations) / len(durations)
    return averages


def _build_run_progress(
    run: Dict[str, Any],
    expected_tools: list[str],
    average_durations: dict[str, float],
    *,
    now_timestamp: float,
) -> Dict[str, Any] | None:
    status = str(run.get("status") or "").lower()
    if status not in {"pending", "queued", "running"} or not expected_tools:
        return None

    expected_tool_set = set(expected_tools)
    completed_tools: list[str] = []
    for result in run.get("results") or []:
        tool_name = result.get("tool")
        if tool_name in expected_tool_set and tool_name not in completed_tools:
            completed_tools.append(str(tool_name))

    total_tools = len(expected_tools)
    completed_count = len(completed_tools)
    next_tool = expected_tools[completed_count] if completed_count < total_tools else None

    started_at = run.get("started_at")
    elapsed_seconds: float | None = None
    if started_at is not None:
        try:
            elapsed_seconds = max(0.0, now_timestamp - float(started_at))
        except (TypeError, ValueError):
            elapsed_seconds = None

    observed_durations = [
        float(result.get("duration"))
        for result in run.get("results") or []
        if result.get("tool") in expected_tool_set
        and isinstance(result.get("duration"), (int, float))
        and float(result.get("duration")) > 0
    ]
    known_average_durations = list(average_durations.values())
    if observed_durations:
        fallback_tool_duration = sum(observed_durations) / len(observed_durations)
    elif known_average_durations:
        fallback_tool_duration = sum(known_average_durations) / len(known_average_durations)
    else:
        fallback_tool_duration = 60.0

    estimated_total_seconds = sum(
        average_durations.get(tool_name, fallback_tool_duration)
        for tool_name in expected_tools
    )
    if estimated_total_seconds <= 0:
        estimated_total_seconds = fallback_tool_duration * total_tools

    completed_fraction = completed_count / total_tools
    if status in {"pending", "queued"}:
        progress_fraction = completed_fraction
    else:
        estimated_fraction = (
            elapsed_seconds / estimated_total_seconds
            if elapsed_seconds is not None and estimated_total_seconds > 0
            else completed_fraction
        )
        progress_fraction = max(completed_fraction, estimated_fraction)
        if completed_count < total_tools:
            progress_fraction = min(progress_fraction, 0.98)
        else:
            progress_fraction = min(progress_fraction, 1.0)

    percent_complete = int(round(progress_fraction * 100))

    if status == "pending":
        phase_label = "Waiting to be scheduled"
    elif status == "queued":
        phase_label = (
            f"Queued to start with {_format_tool_name(expected_tools[0])}"
            if expected_tools
            else "Queued to start"
        )
    elif next_tool is not None:
        phase_label = f"Running {_format_tool_name(next_tool)}"
    else:
        phase_label = "Finalizing results"

    remaining_seconds: float | None = None
    if elapsed_seconds is not None and estimated_total_seconds > elapsed_seconds:
        remaining_seconds = estimated_total_seconds - elapsed_seconds

    return {
        "status": status,
        "percent_complete": percent_complete,
        "completed_count": completed_count,
        "total_tools": total_tools,
        "completed_label": f"{completed_count} of {total_tools} tools complete",
        "phase_label": phase_label,
        "elapsed_label": _format_duration_compact(elapsed_seconds),
        "estimated_total_label": _format_duration_compact(estimated_total_seconds),
        "remaining_label": _format_duration_compact(remaining_seconds),
    }


def _annotate_run_progress(
    runs: list[Dict[str, Any]], expected_tools: list[str], average_durations: dict[str, float]
) -> list[Dict[str, Any]]:
    now_timestamp = time.time()
    annotated: list[Dict[str, Any]] = []
    for run in runs:
        run_copy = dict(run)
        run_copy["progress"] = _build_run_progress(
            run_copy,
            expected_tools,
            average_durations,
            now_timestamp=now_timestamp,
        )
        annotated.append(run_copy)
    return annotated


def _build_trend_chart(points: list[Dict[str, Any]]) -> Dict[str, Any] | None:
    if not points:
        return None

    width = 720
    height = 280
    padding_left = 52
    padding_right = 20
    padding_top = 20
    padding_bottom = 44
    plot_width = width - padding_left - padding_right
    plot_height = height - padding_top - padding_bottom

    measured_durations = [
        float(point["duration"])
        for point in points
        if isinstance(point.get("duration"), (int, float))
    ]
    scale_max = max(measured_durations) if measured_durations else 0.0
    if scale_max <= 0:
        scale_max = 1.0

    x_denominator = max(len(points) - 1, 1)
    rendered_points: list[Dict[str, Any]] = []
    polyline_points: list[str] = []
    x_label_step = max(1, len(points) // 6)

    for index, point in enumerate(points):
        x = padding_left + (plot_width * index / x_denominator)
        duration = point.get("duration")
        has_duration = isinstance(duration, (int, float))
        y = padding_top + plot_height
        if has_duration:
            duration_value = float(duration)
            y = padding_top + plot_height - ((duration_value / scale_max) * plot_height)
            polyline_points.append(f"{x:.2f},{y:.2f}")

        rendered_points.append(
            {
                "x": round(x, 2),
                "y": round(y, 2),
                "label": point.get("label", ""),
                "status": point.get("status", "unknown"),
                "status_class": _status_class(point.get("status")),
                "color": _status_color(point.get("status")),
                "has_duration": has_duration,
                "duration_label": _format_duration_compact(duration if has_duration else None),
                "show_x_label": index % x_label_step == 0 or index == len(points) - 1,
            }
        )

    y_ticks: list[Dict[str, Any]] = []
    for tick_index in range(5):
        fraction = tick_index / 4
        y = padding_top + (plot_height * fraction)
        value = scale_max * (1 - fraction)
        y_ticks.append(
            {
                "y": round(y, 2),
                "label": _format_duration_compact(value),
            }
        )

    return {
        "width": width,
        "height": height,
        "plot_bottom": padding_top + plot_height,
        "plot_left": padding_left,
        "plot_right": width - padding_right,
        "polyline_points": " ".join(polyline_points),
        "points": rendered_points,
        "y_ticks": y_ticks,
    }


def _build_loc_change_chart(points: list[Dict[str, Any]]) -> Dict[str, Any] | None:
    if not points:
        return None

    width = 720
    height = 280
    padding_left = 64
    padding_right = 24
    padding_top = 20
    padding_bottom = 44
    plot_width = width - padding_left - padding_right
    plot_height = height - padding_top - padding_bottom
    baseline_y = padding_top + (plot_height / 2)

    net_values = [int(point.get("net", 0)) for point in points]
    max_abs_value = max((abs(value) for value in net_values), default=1)
    if max_abs_value <= 0:
        max_abs_value = 1

    x_denominator = max(len(points), 1)
    bar_width = min(28.0, max(10.0, (plot_width / max(len(points), 1)) * 0.55))
    x_label_step = max(1, len(points) // 6)

    rendered_points: list[Dict[str, Any]] = []
    for index, point in enumerate(points):
        net = int(point.get("net", 0))
        added = int(point.get("added", 0))
        deleted = int(point.get("deleted", 0))
        center_x = padding_left + ((index + 0.5) * plot_width / x_denominator)
        magnitude = abs(net) / max_abs_value
        bar_height = max(2.0, magnitude * (plot_height / 2)) if net != 0 else 2.0
        y = baseline_y - bar_height if net >= 0 else baseline_y
        color = "#4ade80" if net > 0 else "#f87171" if net < 0 else "#94a3b8"
        rendered_points.append(
            {
                "label": point.get("label", ""),
                "net_label": _format_signed_int(net),
                "added_label": _format_signed_int(added),
                "deleted_label": _format_signed_int(-deleted),
                "x": round(center_x - (bar_width / 2), 2),
                "y": round(y, 2),
                "width": round(bar_width, 2),
                "height": round(bar_height, 2),
                "color": color,
                "show_x_label": index % x_label_step == 0 or index == len(points) - 1,
                "label_x": round(center_x, 2),
            }
        )

    y_ticks = [
        {"y": round(padding_top, 2), "label": _format_signed_int(max_abs_value)},
        {"y": round(baseline_y, 2), "label": "0"},
        {
            "y": round(padding_top + plot_height, 2),
            "label": _format_signed_int(-max_abs_value),
        },
    ]

    return {
        "width": width,
        "height": height,
        "plot_left": padding_left,
        "plot_right": width - padding_right,
        "baseline_y": round(baseline_y, 2),
        "points": rendered_points,
        "y_ticks": y_ticks,
    }


def _build_repository_insights(service: CIService, data_access, repo_id: int):
    repository = service.get_repository(repo_id)
    if not repository:
        return None

    runs = data_access.fetch_recent_test_runs(repo_id, limit=20)
    hydrated = _hydrate_test_runs(data_access, runs)
    expected_tools = _enabled_tool_names(service)
    average_durations = _average_tool_durations(data_access, repo_id, expected_tools)
    hydrated = _annotate_run_progress(hydrated, expected_tools, average_durations)
    summary = data_access.summarize_test_runs(repo_id)
    tracked_repo = service.git_tracker.get_repository(repo_id)
    repo_path = getattr(tracked_repo, "repo_path", None)

    trend_points = _build_trend_points(hydrated)
    trend_chart = _build_trend_chart(trend_points)
    loc_change_points = _build_loc_change_points(repo_path, hydrated)
    loc_change_chart = _build_loc_change_chart(loc_change_points)
    commit_comparison = _build_commit_comparison(hydrated[:10])

    return {
        "repository": repository,
        "test_runs": hydrated,
        "summary": summary,
        "last_run": hydrated[0] if hydrated else None,
        "trend_points": trend_points,
        "trend_chart": trend_chart,
        "loc_change_chart": loc_change_chart,
        "commit_comparison": commit_comparison,
    }


def create_app(config_path: str | None = None, db_path: str | None = None) -> Flask:
    """Create and configure the dashboard Flask application."""
    if _FLASK_IMPORT_ERROR is not None:
        raise RuntimeError(
            "Flask is required to use the Full Auto CI dashboard."
        ) from _FLASK_IMPORT_ERROR

    service = CIService(config_path=config_path, db_path=db_path)
    app = Flask(__name__, template_folder="templates", static_folder="static")

    secret_key = _ensure_secret_key(service)
    app.config["SECRET_KEY"] = secret_key
    app.config["CI_SERVICE"] = service
    app.config["DATA_ACCESS"] = service.data

    dashboard_bp = Blueprint(
        "dashboard",
        __name__,
        template_folder="templates",
        static_folder="static",
    )

    @dashboard_bp.route("/")
    def home():
        service = current_app.config["CI_SERVICE"]
        data_access = current_app.config["DATA_ACCESS"]
        repositories = service.list_repositories()
        enriched = [_summarize_repo(repo, data_access) for repo in repositories]
        overview = _compute_overview_metrics(enriched)
        return render_template("index.html", repositories=enriched, overview=overview)

    @dashboard_bp.route("/partials/repositories")
    def repositories_partial():
        service = current_app.config["CI_SERVICE"]
        data_access = current_app.config["DATA_ACCESS"]
        repositories = service.list_repositories()
        enriched = [_summarize_repo(repo, data_access) for repo in repositories]
        overview = _compute_overview_metrics(enriched)
        return render_template(
            "partials/repositories_overview.html",
            repositories=enriched,
            overview=overview,
        )

    @dashboard_bp.route("/repo/<int:repo_id>")
    def repository_detail(repo_id: int):
        service = current_app.config["CI_SERVICE"]
        data_access = current_app.config["DATA_ACCESS"]
        insights = _build_repository_insights(service, data_access, repo_id)
        if not insights:
            abort(404)

        return render_template(
            "repository_detail.html",
            **insights,
        )

    @dashboard_bp.route("/repo/<int:repo_id>/insights")
    def repository_insights(repo_id: int):
        service = current_app.config["CI_SERVICE"]
        data_access = current_app.config["DATA_ACCESS"]
        insights = _build_repository_insights(service, data_access, repo_id)
        if not insights:
            abort(404)

        return render_template("partials/repository_insights.html", **insights)

    @dashboard_bp.post("/repo/<int:repo_id>/rerun")
    def rerun_test(repo_id: int):
        service = current_app.config["CI_SERVICE"]
        commit_hash = request.form.get("commit_hash")
        if not commit_hash:
            flash("Commit hash is required", "error")
            return redirect(url_for("dashboard.repository_detail", repo_id=repo_id))

        if service.add_test_task(repo_id, commit_hash):
            flash(f"Queued tests for commit {commit_hash[:7]}", "success")
        else:
            flash("Failed to queue test run. Check logs for details.", "error")
        return redirect(url_for("dashboard.repository_detail", repo_id=repo_id))

    app.register_blueprint(dashboard_bp)
    app.add_template_filter(_timeago, name="timeago")
    app.add_template_filter(_status_class, name="status_class")
    return app


__all__ = ["create_app"]
