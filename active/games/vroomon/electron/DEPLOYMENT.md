# Vroomon Deployment

Public target:

- https://vroomon.shsw.dev

Vroomon is a standard web app for `*.shsw.dev`: the launcher serves the
browser build with `scripts/web-server.mjs` (Node HTTP, port 5112), which also
exposes the `/api/feedback` error-reporting endpoint. The Docker image runs
the same web server, so the k8s deployment is a normal HTTP container — no
Electron, no xvfb, no virtual display.

## Current status

| Layer | Status |
|---|---|
| `apps.yaml` entry | ✅ registered as `subdomain: vroomon`, port 5112 |
| Local launcher dashboard | ✅ appears on `http://localhost:3001` |
| `Dockerfile` | ✅ present in this directory (runs `web-server.mjs`) |
| `k8s/vroomon.yaml` | ✅ present in this directory's `k8s/` |
| `cloudflared` ingress rule for `vroomon.shsw.dev` | ❌ pending |
| DNS route in Cloudflare | ❌ pending |
| Pushed image at `127.0.0.1:5000/vroomon:latest` | ❌ pending |

The last two rows are the only blockers between "registered" and "live at
`https://vroomon.shsw.dev`."

## Serving model

- The renderer targets a browser (the game has no desktop-only behavior in
  the served build), so the deploy path is one Node process:
  `node scripts/web-server.mjs` binds `0.0.0.0:5112`, serves the compiled
  `dist/renderer/` files (`game.html` as `/`), and stores error reports from
  the browser as JSONL in `.secrets/feedback.jsonl` (capped at 200 entries).
- Desktop development still works via `./run.sh` (real Electron session),
  but the public deploy and the launcher both use the web server.

## Local origin (dev)

```bash
cd active/games/vroomon
./run.sh            # desktop Electron session (dev only)
# or, the served web build:
cd active/games/vroomon/electron
make web            # node scripts/web-server.mjs  -> http://localhost:5112
```

The launcher (`active/web-apps/launcher/apps.yaml`) starts the same web
server for the public-facing app.

## Shared tunnel ingress rule

Add this to `~/.cloudflared/config.yml` above the catch-all rule:

```yaml
  - hostname: vroomon.shsw.dev
    service: http://127.0.0.1:5112
```

Validate:

```bash
cloudflared tunnel ingress validate ~/.cloudflared/config.yml
```

Restart the tunnel:

```bash
pkill -f 'cloudflared tunnel --config /home/calvin/.cloudflared/config.yml run'
nohup cloudflared tunnel --config /home/calvin/.cloudflared/config.yml run > /tmp/cloudflared.log 2>&1 &
```

## DNS route

After the ingress rule is present, create the public DNS route:

```bash
cloudflared tunnel route dns <tunnel-id> vroomon.shsw.dev
```

If `cloudflared` asks for an origin certificate, provide the Cloudflare-managed
`cert.pem` or set `TUNNEL_TOKEN` from the Zero Trust dashboard.

## Kubernetes deployment

The manifest in `k8s/vroomon.yaml` runs two containers in one pod:

- `vroomon` — the web server (`node scripts/web-server.mjs`) on port 5112,
  image `127.0.0.1:5000/vroomon:latest`
- `cloudflared` — sidecar with the per-app tunnel token, sourced from the
  `vroomon-cloudflared-token` secret

Both share a `vroomon` namespace and a single `vroomon-data` PVC (256 MiB).
The readiness/liveness probes are real HTTP GETs on `/` — the web server
binds the port, so the pod goes Ready only when it actually serves. The
container runs as UID 1001 with `fsGroup: 1001`; the image pre-chowns its
`.secrets` dir and the mount is writable by that user.

### Build and push

```bash
cd active/games/vroomon/electron
docker build -t 127.0.0.1:5000/vroomon:latest .
docker push 127.0.0.1:5000/vroomon:latest
```

### Apply the manifest

```bash
kubectl create namespace vroomon --dry-run=client -o yaml | kubectl apply -f -
kubectl -n vroomon create secret generic vroomon-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/vroomon.yaml
```

### Persistent state

The `vroomon-data` PVC is mounted at `/data/vroomon` for future server-side
state. The browser build currently keeps Hall of Fame / run state **in memory
per session** (no server persistence yet), so the PVC is future-proofing, not
active storage. To wipe anything written there during a major release:

```bash
kubectl -n vroomon delete pvc vroomon-data
kubectl -n vroomon rollout restart deployment/vroomon
```

## Verification

```bash
# Local
curl -I http://127.0.0.1:5112          # 200 text/html (the web server)
npm --prefix active/games/vroomon/electron test
python scripts/check_web_app.py vroomon --e2e   # from the megarepo root

# Cluster
kubectl -n vroomon get pods
kubectl -n vroomon logs -l app=vroomon -c vroomon | head

# Public
getent hosts vroomon.shsw.dev
curl -I https://vroomon.shsw.dev

# Feedback endpoint round-trip
curl -s -X POST http://127.0.0.1:5112/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"errors":[{"id":"manual","message":"hi","type":"Error","timestamp":1700000000000}]}'
```

## Caveats

- **Web state is per-session.** Hall of Fame, run state, and overworld
  progress persist in the browser session only (localStorage is not wired
  yet, and there is no server-side store). The PVC is reserved for when that
  lands.
- **Single replica.** The PVC is `ReadWriteOnce`; single replica is correct
  for a personal app.
- **`runAsNonRoot: true` / UID 1001.** The image chowns `.secrets` and the
  mount to 1001 (`fsGroup` on the pod), so the feedback writer works
  unprivileged.

## Troubleshooting

### Pod stuck in `CrashLoopBackOff`

```bash
kubectl -n vroomon logs -l app=vroomon -c vroomon --previous
```

Common causes:

- Missing `vroomon-cloudflared-token` secret. Recreate with `kubectl create
  secret` (see above).
- The server can't write `.secrets/` (permission). The image should chown it
  to 1001; check `docker exec <pod> ls -la /app/.secrets`.
- npm `postinstall` (patch-package) failing. Check that the image has
  internet access at build time.

### `vroomon.shsw.dev` returns 1033 / 1016 from Cloudflare

The tunnel ingress rule is missing or pointing at the wrong port. Check:

```bash
cloudflared tunnel ingress validate ~/.cloudflared/config.yml
```

Make sure the `vroomon.shsw.dev` block comes before the catch-all
`hostname: "*"` rule.

### Local port 5112 already in use

Change the web-server port (`VROOMON_WEB_PORT`) and the launcher's `apps.yaml`
`port:` together, keeping the k8s port (5112) in sync with the container's
`VROOMON_WEB_PORT` if you move the cluster too.

### Verifying the public URL end to end

```bash
# 1. The pod is up and serving
kubectl -n vroomon get pods

# 2. The web server answers inside the pod
kubectl -n vroomon exec deploy/vroomon -c vroomon -- \
  curl -sI http://127.0.0.1:5112

# 3. The tunnel is alive
cloudflared tunnel info vroomon

# 4. The DNS resolves
dig vroomon.shsw.dev

# 5. The URL returns 200
curl -I https://vroomon.shsw.dev
```

## Maintenance

### Wipe Hall of Fame state

```bash
kubectl -n vroomon delete pvc vroomon-data
kubectl -n vroomon rollout restart deployment/vroomon
```

### Upgrade the Node version / app

1. Bump `node:` in the `Dockerfile` base image or the app version, and run
   `npm install` if deps changed.
2. Re-run `scripts/deploy.sh`. The new image is tagged with the deploy
   timestamp; the previous image is left in the registry for one cycle so a
   rollback is just `kubectl set image`.

### Roll back to the previous image

```bash
kubectl -n vroomon set image deployment/vroomon vroomon=127.0.0.1:5000/vroomon:<previous-tag>
```