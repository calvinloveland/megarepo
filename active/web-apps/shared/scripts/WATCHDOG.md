# App health watchdog

A small watchdog that periodically pings every app in
`active/web-apps/launcher/apps.yaml` and restarts any app whose port
isn't accepting TCP connections. Designed to catch the next
"conway.shsw.dev is down" outage in under 2 minutes without a human
having to notice.

## How it works

1. Loads `apps.yaml` (default path; can override with `--apps-yaml`).
2. For each app, tries a TCP connect to `127.0.0.1:<port>`.
3. If the port is closed, runs a restart command:
   - If the app declares `start_cmd` in apps.yaml, runs that from the
     app's directory. Used for Next.js / Vite / Node apps.
   - Otherwise, if `type: flask` and a `.venv/bin/python3` exists in
     the app dir, runs:
     `cd <path> && nohup env <env-vars> HOST=127.0.0.1 ./.venv/bin/python3 -m <module> < /dev/null > /tmp/<id>.log 2>&1 &`
   - Otherwise, the app is **skipped** (the watchdog refuses to start
     apps it has no safe command for).
4. After a successful restart, the app is "in cooldown" for
   `--cooldown-seconds` (default 300) to avoid restart loops. Cooldown
   state persists in `/tmp/watchdog-state.json`.

## Manual usage

```bash
# One-shot check (good for cron or quick verification)
./watchdog.py --once

# Loop forever, checking every 2 minutes (the systemd timer's mode)
./watchdog.py --watching

# Show what would be done without actually restarting
./watchdog.py --once --dry-run

# Custom cooldown (e.g. 10s while testing)
./watchdog.py --once --cooldown-seconds 10
```

## Wiring it up as a systemd timer

The bundled `watchdog.service` and `watchdog.timer` are user-level
systemd units. To enable them (run once, on this host):

```bash
# Install into your user systemd dir
mkdir -p ~/.config/systemd/user
cp watchdog.service watchdog.timer ~/.config/systemd/user/

# Edit watchdog.service if your user or repo path differs from
# /home/calvin/megarepo.

systemctl --user daemon-reload
systemctl --user enable --now watchdog.timer
systemctl --user list-timers watchdog.timer
```

The timer runs the service every 2 minutes (`OnUnitInactiveSec=2min`)
plus a random 0-15s delay. Each run does a single `--once` check.

## What it can and can't restart

| App kind                 | Restart works? | Why |
|--------------------------|----------------|-----|
| Flask with `.venv`       | ✅             | Convention `python3 -m <module>` matches the existing launch commands |
| Flask with system Python | ❌ (skipped)   | No safe way to know which interpreter to use; the watchdog leaves it alone so you don't get a half-broken restart |
| Apps with `start_cmd`     | ✅             | The exact command from apps.yaml is used |
| Apps missing `start_cmd` AND not flask+venv | ❌ (skipped) | Same reason |

If your app falls into a "skipped" bucket, add an explicit
`start_cmd: "your-launch-command"` to apps.yaml. The watchdog will
pick it up automatically on the next cycle.

## Inspecting the log

```bash
tail -f /tmp/watchdog.log
```

The log is also rotated by `logrotate` if installed. Lines look like:

```
[2026-06-13T18:28:03+00:00] down: conway-war (port 5106) — attempting restart
[2026-06-13T18:28:03+00:00] restart conway-war: cd /home/calvin/megarepo/active/games/conway_game_of_war && nohup env ...
[2026-06-13T18:28:07+00:00] watchdog: cycle complete, 2 restart(s) issued
```

## Why not just use k8s liveness probes?

The k8s manifests in each app's `k8s/` directory are for the
"thinker" k3s cluster setup (see
`active/web-apps/launcher/SHSW_DEV_DEPLOYMENT.md`), not the local
deployment where each app runs as a long-lived `python3 -m ...` on a
fixed port behind the shared cloudflared tunnel. The watchdog is the
equivalent safety net for that local deployment: no docker, no
systemd unit per app, just a single timer that pings and restarts.
