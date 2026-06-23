#!/usr/bin/env python3
"""
Warden Dashboard — Flask web UI showing aggregated host health across
all known Warden-managed hosts.

Usage:
  python3 app.py [--port 9091] [--bind 127.0.0.1]

Designed to run as a systemd service bound to the Tailscale IP so it's
accessible from any host on the tailnet.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add parent dir for warden_state imports
WARDEN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WARDEN_DIR))

try:
    from flask import Flask, jsonify, render_template_string, request
except ImportError:
    print("Flask is required. Install it with: pip install flask", file=sys.stderr)
    print("Or add python3Packages.flask to your Nix configuration.", file=sys.stderr)
    sys.exit(1)

from warden_state import (
    get_hostname,
    get_or_create_host_id,
    get_storage_report,
    load_config,
    load_peer_status,
    load_state,
    list_peers,
    read_events,
    utc_now,
)

app = Flask(__name__)

# ── Helpers ─────────────────────────────────────────────────────────


def fetch_peer_status(host: str, port: int = 9090, timeout: int = 5) -> dict[str, Any] | None:
    """Fetch status from a peer Warden's HTTP API."""
    url = f"http://{host}:{port}/warden/status"
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            data["_reachable"] = True
            data["_host"] = host
            data["_port"] = port
            return data
    except Exception as e:
        return {
            "_reachable": False,
            "_host": host,
            "_port": port,
            "_error": str(e),
            "hostname": host,
            "summary": {"overall": "unreachable", "check_count": 0, "pass_count": 0, "warn_count": 0, "fail_count": 0},
            "checks": {},
        }


def get_local_status() -> dict[str, Any]:
    """Get local Warden status, enriched with HomeCluster storage data."""
    state = load_state()
    state["_reachable"] = True
    state["_host"] = "localhost"
    state["_port"] = 0
    state["_local"] = True
    checks = state.get("checks", {})
    state["summary"] = {
        "overall": "healthy" if all(c.get("status") in ("pass", "warn") for c in checks.values()) else "degraded",
        "check_count": len(checks),
        "pass_count": sum(1 for c in checks.values() if c.get("status") == "pass"),
        "warn_count": sum(1 for c in checks.values() if c.get("status") == "warn"),
        "fail_count": sum(1 for c in checks.values() if c.get("status") == "fail"),
    }
    # Enrich with HomeCluster storage data
    storage = get_storage_report()
    if storage:
        state["homecluster"] = storage
    return state


def compute_storage_pool(hosts: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate storage across all hosts into a cluster pool view."""
    pool = {
        "total_capacity_bytes": 0,
        "total_free_bytes": 0,
        "total_used_bytes": 0,
        "node_count": 0,
        "online_count": 0,
        "by_class": {},
        "per_node": [],
    }

    for host in hosts:
        if not host.get("_reachable"):
            continue
        pool["online_count"] += 1

        hc = host.get("homecluster", {})
        summary = hc.get("summary", {})
        if not summary:
            continue

        pool["node_count"] += 1
        cap = summary.get("total_capacity_bytes", 0)
        free = summary.get("total_free_bytes", 0)
        pool["total_capacity_bytes"] += cap
        pool["total_free_bytes"] += free

        # Per-class aggregation
        by_class = summary.get("by_class", {})
        for cls, info in by_class.items():
            if cls not in pool["by_class"]:
                pool["by_class"][cls] = {"capacity_bytes": 0, "free_bytes": 0, "node_count": 0, "mount_count": 0}
            pool["by_class"][cls]["capacity_bytes"] += info.get("capacity_bytes", 0)
            pool["by_class"][cls]["free_bytes"] += info.get("free_bytes", 0)
            pool["by_class"][cls]["node_count"] += info.get("node_count", 0)
            pool["by_class"][cls]["mount_count"] += info.get("mount_count", 0)

        # Per-node summary
        pool["per_node"].append({
            "hostname": host.get("hostname", "?"),
            "capacity_bytes": cap,
            "free_bytes": free,
            "used_bytes": cap - free,
            "used_pct": round((cap - free) / cap * 100, 1) if cap else 0,
            "by_class": by_class,
        })

    pool["total_used_bytes"] = pool["total_capacity_bytes"] - pool["total_free_bytes"]
    if pool["total_capacity_bytes"]:
        pool["total_used_pct"] = round(pool["total_used_bytes"] / pool["total_capacity_bytes"] * 100, 1)
    else:
        pool["total_used_pct"] = 0

    return pool


def format_bytes(n: int) -> str:
    """Format byte count to human-readable string."""
    if n >= 1e12:
        return f"{n / 1e12:.1f} TB"
    elif n >= 1e9:
        return f"{n / 1e9:.1f} GB"
    elif n >= 1e6:
        return f"{n / 1e6:.1f} MB"
    else:
        return f"{n} B"


def discover_peers() -> list[dict[str, Any]]:
    """Discover peer Wardens from config and cache."""
    config = load_config()
    peer_configs = config.get("peers", {})
    cached = list_peers()

    peers: list[dict[str, Any]] = []
    seen = set()

    # From config
    for name, cfg in peer_configs.items():
        if name not in seen:
            seen.add(name)
            peers.append({
                "name": name,
                "host": cfg.get("host", name),
                "port": cfg.get("port", 9090),
                "source": "config",
            })

    # From cache (may have extra entries from dynamic discovery)
    for name in cached:
        if name not in seen:
            seen.add(name)
            cached_status = load_peer_status(name)
            peers.append({
                "name": name,
                "host": name,
                "port": 9090,
                "source": "cache",
                "cached_status": cached_status,
            })

    return peers


def status_icon(status: str) -> str:
    icons = {"pass": "🟢", "warn": "🟡", "fail": "🔴", "healthy": "🟢", "degraded": "🟡", "unreachable": "⚫", "unknown": "⚪"}
    return icons.get(status, "⚪")


def time_ago(ts: str | None) -> str:
    if not ts:
        return "never"
    try:
        dt = datetime.fromisoformat(ts)
        delta = datetime.now(timezone.utc).replace(tzinfo=None) - dt.replace(tzinfo=None)
        seconds = int(delta.total_seconds())
        if seconds < 60:
            return f"{seconds}s ago"
        elif seconds < 3600:
            return f"{seconds // 60}m ago"
        elif seconds < 86400:
            return f"{seconds // 3600}h ago"
        else:
            return f"{seconds // 86400}d ago"
    except (ValueError, TypeError):
        return ts[:19] if ts else "?"


# ── HTML Template ───────────────────────────────────────────────────

INDEX_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Warden Dashboard — {{ local.hostname }}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0d1117; color: #c9d1d9; padding: 20px; }
        h1 { font-size: 1.5rem; margin-bottom: 4px; color: #58a6ff; }
        .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
        .host-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                     gap: 16px; margin-bottom: 24px; }
        .host-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
                     padding: 16px; }
        .host-card.unreachable { opacity: 0.6; }
        .host-header { display: flex; justify-content: space-between; align-items: center;
                       margin-bottom: 12px; }
        .host-name { font-size: 1.1rem; font-weight: 600; }
        .host-name a { color: #58a6ff; text-decoration: none; }
        .host-name a:hover { text-decoration: underline; }
        .overall-badge { font-size: 0.8rem; padding: 2px 8px; border-radius: 12px;
                         font-weight: 500; }
        .badge-pass { background: #1b3a2d; color: #3fb950; }
        .badge-warn { background: #3d2e00; color: #d29922; }
        .badge-fail { background: #3d1114; color: #f85149; }
        .badge-unknown { background: #21262d; color: #8b949e; }
        .summary-row { display: flex; gap: 12px; margin-bottom: 10px; font-size: 0.85rem; }
        .summary-item { color: #8b949e; }
        .summary-item span { color: #c9d1d9; font-weight: 500; }
        .checks { }
        .check-row { display: flex; justify-content: space-between; align-items: center;
                     padding: 4px 0; font-size: 0.8rem; border-bottom: 1px solid #21262d; }
        .check-row:last-child { border-bottom: none; }
        .check-name { color: #c9d1d9; }
        .check-status { font-size: 0.75rem; }
        .check-time { color: #8b949e; font-size: 0.7rem; }
        .backup-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid #21262d;
                      font-size: 0.8rem; color: #8b949e; }
        .backup-row span { color: #c9d1d9; }
        .error-msg { color: #f85149; font-size: 0.8rem; margin-top: 4px; }
        .refresh-bar { display: flex; justify-content: space-between; align-items: center;
                       margin-bottom: 16px; font-size: 0.8rem; color: #8b949e; }
        .refresh-bar a { color: #58a6ff; text-decoration: none; }
        .refresh-bar a:hover { text-decoration: underline; }
        .footer { text-align: center; font-size: 0.75rem; color: #484f58; margin-top: 24px; }
        .events-section { margin-top: 24px; }
        .events-section h2 { font-size: 1rem; color: #58a6ff; margin-bottom: 8px; }
        .event-row { font-size: 0.8rem; padding: 3px 0; border-bottom: 1px solid #21262d;
                     font-family: monospace; }
        .event-time { color: #8b949e; }
        .event-check { color: #c9d1d9; }
        .event-msg { color: #8b949e; }
        /* ── Storage Pool Hero ─────────────────────────────── */
        .storage-pool-hero {
            background: linear-gradient(135deg, #161b22 0%, #1c2333 100%);
            border: 1px solid #30363d;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .pool-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .pool-title {
            font-size: 1.15rem;
            font-weight: 600;
            color: #58a6ff;
        }
        .pool-nodes {
            font-size: 0.8rem;
            color: #8b949e;
        }
        .pool-bar-container {
            margin-bottom: 12px;
        }
        .pool-bar {
            background: #21262d;
            border-radius: 6px;
            height: 18px;
            overflow: hidden;
            margin-bottom: 4px;
        }
        .pool-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #3fb950 0%, #d29922 70%, #f85149 100%);
            border-radius: 6px;
            transition: width 0.5s ease;
        }
        .pool-bar-labels {
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            color: #8b949e;
        }
        .pool-classes {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .pool-class {
            background: #21262d;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 0.75rem;
            flex: 1;
            min-width: 120px;
        }
        .pool-class-label {
            font-weight: 600;
            color: #c9d1d9;
            display: block;
            margin-bottom: 2px;
        }
        .pool-class-free {
            color: #3fb950;
            display: block;
        }
        .pool-class-total {
            color: #8b949e;
            display: block;
        }
        /* ── Per-Node Storage ───────────────────────────────── */
        .storage-row {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #21262d;
        }
        .storage-title {
            font-size: 0.75rem;
            color: #8b949e;
            margin-bottom: 4px;
        }
        .storage-bar-container {
            margin-bottom: 4px;
        }
        .storage-bar {
            background: #21262d;
            border-radius: 4px;
            height: 8px;
            overflow: hidden;
        }
        .storage-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #3fb950 0%, #d29922 80%, #f85149 100%);
            border-radius: 4px;
        }
        .storage-bar-text {
            font-size: 0.65rem;
            color: #8b949e;
            margin-top: 2px;
        }
        .storage-classes {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-top: 4px;
        }
        .storage-class-chip {
            font-size: 0.6rem;
            padding: 1px 6px;
            border-radius: 8px;
            background: #21262d;
            color: #8b949e;
        }
        .chip-ssd { border-left: 2px solid #58a6ff; }
        .chip-hdd { border-left: 2px solid #d29922; }
        .chip-archive { border-left: 2px solid #8b949e; }
        @media (max-width: 600px) {
            .host-grid { grid-template-columns: 1fr; }
            .pool-classes { flex-direction: column; }
        }
    </style>
</head>
<body>
    <h1>🛡 Warden Dashboard</h1>
    <div class="subtitle">
        {{ local.hostname }} — {{ local.host_id[:8] }}
        | <a href="/events">Events</a>
        | <a href="/api/hosts">JSON API</a>
        | auto-refresh every 30s
    </div>

    <div class="refresh-bar">
        <span>Last updated: {{ now[:19] }}</span>
        <a href="/">⟳ Refresh</a>
    </div>

    {% if storage_pool.node_count > 0 %}
    <!-- HomeCluster Storage Pool -->
    <div class="storage-pool-hero">
        <div class="pool-header">
            <span class="pool-title">📦 HomeCluster Storage Pool</span>
            <span class="pool-nodes">{{ storage_pool.online_count }}/{{ storage_pool.node_count }} nodes online</span>
        </div>
        <div class="pool-bar-container">
            <div class="pool-bar">
                <div class="pool-bar-fill" style="width: {{ storage_pool.total_used_pct }}%"></div>
            </div>
            <div class="pool-bar-labels">
                <span>{{ format_bytes(storage_pool.total_free_bytes) }} free</span>
                <span>{{ storage_pool.total_used_pct }}% used</span>
                <span>{{ format_bytes(storage_pool.total_capacity_bytes) }} total</span>
            </div>
        </div>
        <div class="pool-classes">
            {% for cls, info in storage_pool.by_class.items() %}
            <div class="pool-class">
                <span class="pool-class-label">
                    {% if cls == 'ssd' %}⚡{% elif cls == 'hdd' %}💿{% elif cls == 'archive' %}🗄️{% else %}💾{% endif %}
                    {{ cls.upper() }}
                </span>
                <span class="pool-class-free">{{ format_bytes(info.free_bytes) }} free</span>
                <span class="pool-class-total">{{ format_bytes(info.capacity_bytes) }} total</span>
            </div>
            {% endfor %}
        </div>
    </div>
    {% endif %}

    <div class="host-grid">
        {% for host in hosts %}
        <div class="host-card{% if not host._reachable %} unreachable{% endif %}">
            <div class="host-header">
                <div class="host-name">
                    {{ status_icon(host.summary.overall) }}
                    <a href="/host/{{ host.hostname }}">{{ host.hostname }}</a>
                </div>
                <span class="overall-badge badge-{{ host.summary.overall }}">
                    {{ host.summary.overall }}
                </span>
            </div>

            <div class="summary-row">
                <div class="summary-item">Checks: <span>{{ host.summary.check_count }}</span></div>
                <div class="summary-item" style="color:#3fb950">✓ <span>{{ host.summary.pass_count }}</span></div>
                <div class="summary-item" style="color:#d29922">⚠ <span>{{ host.summary.warn_count }}</span></div>
                <div class="summary-item" style="color:#f85149">✗ <span>{{ host.summary.fail_count }}</span></div>
                {% if not host._reachable %}
                <div class="summary-item" style="color:#f85149">● disconnected</div>
                {% endif %}
            </div>

            {% if host._reachable and host.checks %}
            <div class="checks">
                {% for name, check in (host.checks.items()|list)[:6] %}
                <div class="check-row">
                    <span class="check-name">{{ name }}</span>
                    <span>
                        <span class="check-status">{{ status_icon(check.status) }} {{ check.status }}</span>
                        <span class="check-time">{{ time_ago(check.last_run) }}</span>
                    </span>
                </div>
                {% endfor %}
                {% if host.checks|length > 6 %}
                <div class="check-row" style="color:#8b949e">
                    <span>… and {{ host.checks|length - 6 }} more</span>
                </div>
                {% endif %}
            </div>
            {% endif %}

            {% if host._reachable and host.backups %}
            <div class="backup-row">
                {% set last = host.backups.last_run or '' %}
                Backup: <span>{{ last[:19] if last else 'never' }}</span>
                {% if host.backups.repositories %}
                | {% for name, repo in (host.backups.repositories.items()|list)[:2] %}
                    {{ name }}: <span>{{ repo.status or '?' }}</span>{% if not loop.last %}, {% endif %}
                {% endfor %}
                {% endif %}
            </div>
            {% endif %}

            {% if host._reachable and host.homecluster %}
            {% set hc = host.homecluster %}
            {% set s = hc.summary %}
            <div class="storage-row">
                <div class="storage-title">💾 Storage</div>
                <div class="storage-bar-container">
                    <div class="storage-bar">
                        <div class="storage-bar-fill" style="width: {{ s.total_used_pct }}%"></div>
                    </div>
                    <div class="storage-bar-text">{{ format_bytes(s.total_free_bytes) }} free / {{ format_bytes(s.total_capacity_bytes) }}</div>
                </div>
                {% if s.by_class %}
                <div class="storage-classes">
                    {% for cls, info in s.by_class.items() %}
                    <span class="storage-class-chip chip-{{ cls }}" title="{{ info.mount_count }} mount(s), {{ format_bytes(info.capacity_bytes) }} total">
                        {{ cls.upper() }} {{ format_bytes(info.free_bytes) }}
                    </span>
                    {% endfor %}
                </div>
                {% endif %}
            </div>
            {% endif %}

            {% if host._reachable and host.generation %}
            <div class="backup-row">
                Generation: <span>{{ host.generation.current or '?' }}</span>
            </div>
            {% endif %}

            {% if not host._reachable %}
            <div class="error-msg">● {{ host._error }}</div>
            {% endif %}
        </div>
        {% endfor %}
    </div>

    <div class="events-section">
        <h2>Recent Events</h2>
        {% for event in events[:15] %}
        <div class="event-row">
            <span class="event-time">{{ event.timestamp[:19] }}</span>
            <span class="event-check">{{ status_icon(event.status) }} {{ event.type }}/{{ event.check or '' }}</span>
            <span class="event-msg">— {{ event.message[:80] }}</span>
        </div>
        {% endfor %}
        {% if events|length > 15 %}
        <div class="event-row" style="color:#8b949e">… and {{ events|length - 15 }} more</div>
        {% endif %}
    </div>

    <div class="footer">
        Warden v1 — <a href="https://github.com/calvinloveland/megarepo">megarepo</a>
    </div>
</body>
</html>
"""


# ── Routes ──────────────────────────────────────────────────────────


@app.route("/")
def index():
    """Main dashboard — shows all hosts and aggregated storage pool."""
    local = get_local_status()
    peer_list = discover_peers()

    hosts = [local]
    for peer in peer_list:
        status = fetch_peer_status(peer["host"], peer["port"])
        if status:
            hosts.append(status)

    storage_pool = compute_storage_pool(hosts)
    events = read_events(tail=50)

    return render_template_string(
        INDEX_HTML,
        local=local,
        hosts=hosts,
        storage_pool=storage_pool,
        events=events,
        now=utc_now(),
        status_icon=status_icon,
        time_ago=time_ago,
        format_bytes=format_bytes,
    )


@app.route("/host/<hostname>")
def host_detail(hostname: str):
    """Detailed view of a specific host."""
    local = get_local_status()

    if hostname == local.get("hostname"):
        data = local
    else:
        peer_list = discover_peers()
        peer = next((p for p in peer_list if p["name"] == hostname or p["host"] == hostname), None)
        if peer:
            data = fetch_peer_status(peer["host"], peer["port"]) or {}
        else:
            data = {"hostname": hostname, "_reachable": False, "_error": "Unknown host"}

    storage_pool = compute_storage_pool([local, data] if data.get("_reachable") else [local])
    events = read_events(tail=50)

    return render_template_string(
        INDEX_HTML.replace("/host/{{ host.hostname }}", "/host/{{ host.hostname }}" if hostname != data.get("hostname", "") else ""),
        local=local,
        hosts=[data],
        storage_pool=storage_pool,
        events=events,
        now=utc_now(),
        status_icon=status_icon,
        time_ago=time_ago,
        format_bytes=format_bytes,
    )


@app.route("/events")
def events_page():
    """Show event log."""
    events = read_events(tail=200)
    return render_template_string("""
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>Warden Events</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
        h1 { font-size: 1.2rem; color: #58a6ff; margin-bottom: 12px; }
        .event { padding: 3px 0; border-bottom: 1px solid #21262d; font-size: 0.8rem; }
        .time { color: #8b949e; }
        .type { color: #58a6ff; }
        .check { color: #c9d1d9; }
        .status { }
        .msg { color: #8b949e; }
        a { color: #58a6ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .count { color: #8b949e; font-size: 0.8rem; margin-bottom: 8px; }
    </style>
    </head>
    <body>
        <h1>🛡 Warden Events</h1>
        <div class="count">{{ events|length }} events | <a href="/">← Dashboard</a></div>
        {% for event in events %}
        <div class="event">
            <span class="time">{{ event.timestamp[:19] }}</span>
            <span class="type">{{ event.type }}</span>
            {% if event.check %}<span class="check">/{{ event.check }}</span>{% endif %}
            <span class="status">{{ status_icon(event.status) }} {{ event.status }}</span>
            <span class="msg">— {{ event.message[:120] }}</span>
        </div>
        {% endfor %}
    </body>
    </html>
    """, events=events, status_icon=status_icon)


@app.route("/api/hosts")
def api_hosts():
    """JSON endpoint returning all hosts' status with storage pool."""
    local = get_local_status()
    peer_list = discover_peers()

    hosts = [local]
    for peer in peer_list:
        status = fetch_peer_status(peer["host"], peer["port"])
        if status:
            hosts.append(status)

    storage_pool = compute_storage_pool(hosts)

    return jsonify({
        "timestamp": utc_now(),
        "host_count": len(hosts),
        "hosts": hosts,
        "storage_pool": storage_pool,
    })


@app.route("/api/storage/pool")
def api_storage_pool():
    """JSON endpoint for just the aggregated storage pool."""
    local = get_local_status()
    peer_list = discover_peers()

    hosts = [local]
    for peer in peer_list:
        status = fetch_peer_status(peer["host"], peer["port"])
        if status:
            hosts.append(status)

    storage_pool = compute_storage_pool(hosts)
    return jsonify(storage_pool)


@app.route("/api/host/<hostname>")
def api_host(hostname: str):
    """JSON endpoint for a specific host."""
    local = get_local_status()

    if hostname == local.get("hostname"):
        return jsonify(local)

    peer_list = discover_peers()
    peer = next((p for p in peer_list if p["name"] == hostname or p["host"] == hostname), None)
    if peer:
        data = fetch_peer_status(peer["host"], peer["port"])
        if data:
            return jsonify(data)

    return jsonify({"error": f"Host {hostname} not found", "hostname": hostname}), 404


# ── Utility endpoint for Tailscale IP detection ─────────────────────


@app.route("/health")
def health():
    return jsonify({"status": "ok", "hostname": get_hostname()})


# ── CLI ─────────────────────────────────────────────────────────────


def find_tailscale_ip() -> str | None:
    """Get the first Tailscale IP address for binding."""
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            self_info = data.get("Self", {})
            ips = self_info.get("TailscaleIPs", [])
            return ips[0] if ips else None
    except Exception:
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description="Warden Dashboard web UI")
    parser.add_argument("--port", type=int, default=9091, help="Port to listen on")
    parser.add_argument("--bind", default=None, help="Bind address (default: Tailscale IP or 127.0.0.1)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--state-dir", default=None, help="Warden state directory")
    args = parser.parse_args()

    if args.state_dir:
        os.environ["WARDEN_STATE_DIR"] = args.state_dir

    bind = args.bind
    if not bind:
        ts_ip = find_tailscale_ip()
        bind = ts_ip or "127.0.0.1"
        print(f"[warden-dashboard] Binding to {bind}", file=sys.stderr)

    print(f"[warden-dashboard] Starting on {bind}:{args.port}", file=sys.stderr)
    print(f"[warden-dashboard] Host: {get_hostname()}", file=sys.stderr)
    app.run(host=bind, port=args.port, debug=args.debug, use_reloader=False)


if __name__ == "__main__":
    main()
