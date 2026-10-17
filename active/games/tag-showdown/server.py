"""The tournament server: a small local web server that validates agent files and plays the best-of-five.

    python server.py                              open http://127.0.0.1:8000 and drop in two agent files
    python server.py --secret "event 2026"        the organizer's secret seed (decides all five arenas)
    python server.py --log practice.jsonl         append one line per series (names, score, winner) to a file

Only the standard library plus numpy. The browser sends agent files here; Python does all the simulating and sends
the replays back; the page only draws them. The secret seed never leaves this server.
"""
import argparse
import json
import re
import mimetypes
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agent import check_agent_bytes, check_agent_data
from match import play_series
from spec import ENV_VERSION, SPEC

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER = os.path.join(HERE, "viewer")
MAX_BODY = 2 * SPEC["agent_file"]["max_file_bytes"] + 100_000        # two agent files plus a little wrapping
THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"


class Settings:
    secret = "practice"
    log_path = None
    log_lock = threading.Lock()


def describe_report(rep):
    out = {"ok": rep.ok, "problems": rep.problems, "warnings": rep.warnings, "summary": rep.summary}
    if rep.agent is not None:
        out.update(name=rep.agent.name, role=rep.agent.role, color=rep.agent.color)
    return out


def api_validate(raw):
    return 200, describe_report(check_agent_bytes(raw))


def _sensed_cells(agent):
    """[[dx, dy], ...]: the block-sensor cells (relative to the agent's own cell) that this agent's network reads."""
    cells = []
    for name in agent.inputs:
        m = re.fullmatch(r"blk_(-?\d+)_(-?\d+)", name)
        if m:
            cells.append([int(m.group(1)), int(m.group(2))])
    return cells


def api_series(raw):
    try:
        body = json.loads(raw)
        files = {role: body[role] for role in ("chaser", "evader")}
    except (ValueError, KeyError, TypeError):
        return 400, {"error": 'Send a JSON object with two agent files: {"chaser": {...}, "evader": {...}}.'}
    reports, problems = {}, []
    for role, data in files.items():
        reports[role] = check_agent_data(data)
        problems += [f"{role} file: {p}" for p in reports[role].problems]
        if reports[role].ok and reports[role].agent.role != role:
            problems.append(f"The {role} slot holds '{reports[role].agent.name}', which was trained as the "
                            f"{reports[role].agent.role}. Put it in the {reports[role].agent.role} slot.")
    if problems:
        return 422, {"error": "These agents cannot compete yet.", "problems": problems,
                     "validation": {r: describe_report(rep) for r, rep in reports.items()}}
    started = time.time()
    result = play_series(reports["chaser"].agent, reports["evader"].agent, Settings.secret)
    result["env_version"] = ENV_VERSION
    result["senses"] = [_sensed_cells(reports[r].agent) for r in ("chaser", "evader")]    # lets the viewer light up what each agent reads
    result["seconds"] = round(time.time() - started, 2)
    result["validation"] = {r: describe_report(rep) for r, rep in reports.items()}
    if Settings.log_path:
        line = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "chaser": result["chaser"], "evader": result["evader"],
                "chaser_wins": result["chaser_wins"], "evader_wins": result["evader_wins"],
                "winner": result["winner_name"], "match_winners": [m["winner"] for m in result["matches"]]}
        with Settings.log_lock, open(Settings.log_path, "a") as f:
            f.write(json.dumps(line) + "\n")
    return 200, result


def api_info():
    return {"env_version": ENV_VERSION, "tournament": SPEC["tournament"], "network_limits": SPEC["network_limits"],
            "max_file_bytes": SPEC["agent_file"]["max_file_bytes"], "practice_secret": Settings.secret == "practice"}


class Handler(BaseHTTPRequestHandler):
    server_version = "TagServer/1"

    def log_message(self, fmt, *args):                              # quiet: one line per API call only
        if self.path.startswith("/api/"):
            sys.stderr.write(f"{self.log_date_time_string()}  {self.command} {self.path}  {args[1] if len(args) > 1 else ''}\n")

    def send_json(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/info":
            return self.send_json(200, api_info())
        rel = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
        root = VIEWER
        if rel.startswith("baselines/"):                                 # the baseline agents are served for the "try it" button
            root, rel = os.path.join(HERE, "baselines"), rel[len("baselines/"):]
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            return self.send_json(404, {"error": "not found"})
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith(("javascript", "json")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        route = {"/api/validate": api_validate, "/api/series": api_series}.get(self.path)
        if route is None:
            return self.send_json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.send_json(411, {"error": "Content-Length is required."})
        if length > MAX_BODY:
            remaining = min(length, 50_000_000)                          # read and discard, so the browser sees our answer, not a reset
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                remaining -= len(chunk)
            self.close_connection = True
            return self.send_json(413, {"error": f"That is too large to be agent files (limit {MAX_BODY // 1_000_000 + 1} MB)."})
        try:
            status, obj = route(self.rfile.read(length))
        except Exception as ex:                                      # never leave the browser hanging
            status, obj = 500, {"error": f"The server hit a problem: {type(ex).__name__}: {ex}"}
        self.send_json(status, obj)


def ensure_three():
    """Fetch three.js once for offline use. Failing is fine: the viewer falls back to the CDN, then to a flat 2D view."""
    target = os.path.join(VIEWER, "vendor", "three.min.js")
    if os.path.exists(target):
        return True
    try:
        import urllib.request
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with urllib.request.urlopen(THREE_URL, timeout=8) as r:
            data = r.read()
        if b"WebGLRenderer" not in data:
            return False
        with open(target, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let other computers on your network connect")
    ap.add_argument("--secret", default="practice", help="secret seed text (int or any text)")
    ap.add_argument("--log", help="append a one-line result per series to this file (JSON lines)")
    a = ap.parse_args()
    Settings.secret = int(a.secret) if a.secret.lstrip("-").isdigit() else a.secret
    Settings.log_path = a.log
    have_three = ensure_three()
    httpd = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"Tag tournament server: http://{a.host}:{a.port}   (secret seed: {'practice' if a.secret == 'practice' else 'set'})")
    if not have_three:
        print("(Could not download three.js for offline use; the page will try the internet, or show the flat 2D view.)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
