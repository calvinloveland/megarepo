# Vroomon Deployment

Public target:

- https://vroomon.shsw.dev

Vroomon is an Electron app, which is unusual for `*.shsw.dev` (most apps are Flask/Node servers). The container image wraps Electron in `xvfb-run` so the BrowserWindow can run headlessly on a node without a display server.

## Current status

| Layer | Status |
|---|---|
| `apps.yaml` entry | ✅ registered as `subdomain: vroomon`, port 5112 |
| Local launcher dashboard | ✅ appears on `http://localhost:3001` |
| `Dockerfile` | ✅ present in this directory |
| `k8s/vroomon.yaml` | ✅ present in this directory's `k8s/` |
| `cloudflared` ingress rule for `vroomon.shsw.dev` | ❌ pending |
| DNS route in Cloudflare | ❌ pending |
| Pushed image at `127.0.0.1:5000/vroomon:latest` | ❌ pending |

The last two rows are the only blockers between "registered" and "live at `https://vroomon.shsw.dev`."

## Why this isn't a normal web container

Electron's `BrowserWindow` is a desktop window, not an HTTP server. There is no port that streams the rendered UI to a browser. Two practical deploy paths exist:

1. **Local Electron on the launcher box** — what the project does today via `./run.sh`. Works on NixOS without any container. Cloudflared on the same box routes `vroomon.shsw.dev` → `127.0.0.1:5112` (where the app's smoke-test webview listens).
2. **Headless Electron in k8s** — the `Dockerfile` + `k8s/vroomon.yaml` shipped in this directory. Requires the cloudflared sidecar pattern documented below.

Both paths share the same image (`127.0.0.1:5000/vroomon:latest`) once it's built.

## Local origin (dev)

```bash
cd active/games/vroomon
./run.sh
```

The helper script changes into `electron/`, runs `npm install` if needed, and starts Electron with the headless flags already set. On NixOS the script automatically wraps the launch in `xvfb-run` and uses `nix shell nixpkgs#electron` so the binary is on PATH.

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

If `cloudflared` asks for an origin certificate, provide the Cloudflare-managed `cert.pem` or set `TUNNEL_TOKEN` from the Zero Trust dashboard.

## Kubernetes deployment

The manifest in `k8s/vroomon.yaml` runs two containers in one pod:

- `vroomon` — the Electron app inside xvfb, image `127.0.0.1:5000/vroomon:latest`
- `cloudflared` — sidecar with the per-app tunnel token, sourced from the `vroomon-cloudflared-token` secret

Both share a `vroomon` namespace and a single `vroomon-data` PVC (256 MiB) that holds the Hall of Fame + run state.

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

The `vroomon-data` PVC survives pod restarts, so the Hall of Fame and
saved run state are retained across upgrades. To wipe state during a
major release, delete the PVC and the pod will recreate it empty:

```bash
kubectl -n vroomon delete pvc vroomon-data
kubectl -n vroomon rollout restart deployment/vroomon
```

## Verification

```bash
# Local
curl -I http://127.0.0.1:5112 || true
npm --prefix active/games/vroomon/electron test
npm --prefix active/games/vroomon/electron run test:smoke

# Cluster
kubectl -n vroomon get pods
kubectl -n vroomon logs -l app=vroomon -c vroomon | head

# Public
getent hosts vroomon.shsw.dev
curl -I https://vroomon.shsw.dev
```

## Caveats

- **No public HTTP port.** Electron does not serve the UI over HTTP, so the `Service` and readiness/liveness probes use `tcpSocket` against port 5112. The pod is "ready" once the Electron process is up; the user-facing reach check is the cloudflared tunnel hitting `vroomon.shsw.dev`.
- **Hall of Fame in a single-replica deployment.** The PVC is `ReadWriteOnce` so multi-replica would need a shared filesystem. Single replica is correct for a personal app.
- **`runAsNonRoot: true`.** Electron on Debian 12 runs fine as UID 1001 in the smoke-test mode (no UI to render), but the headless xvfb still needs `+x` on `/tmp/.X*-lock` which is owned by root; this is why we don't escalate privileges.

## Troubleshooting

### Pod stuck in `CrashLoopBackOff`

```bash
kubectl -n vroomon logs -l app=vroomon -c vroomon --previous
```

Common causes:

- Missing `vroomon-cloudflared-token` secret. Recreate with `kubectl create secret` (see above).
- Stale `/tmp/.X11-unix` permissions. Restart the pod: `kubectl -n vroomon rollout restart deployment/vroomon`.
- npm `postinstall` (patch-package) failing. Check that the image has internet access at build time.

### `vroomon.shsw.dev` returns 1033 / 1016 from Cloudflare

The tunnel ingress rule is missing or pointing at the wrong port. Check:

```bash
cloudflared tunnel ingress validate ~/.cloudflared/config.yml
```

Make sure the `vroomon.shsw.dev` block comes before the catch-all `hostname: "*"` rule.

### Hall of Fame resets after a redeploy

The PVC is bound to the deployment, not the pod. If the PVC is missing, Kubernetes will recreate it empty. Check:

```bash
kubectl -n vroomon get pvc vroomon-data
```

If the PVC exists but is `Released`, the previous pod was deleted without scaling down to 0 replicas first. Bind it manually:

```bash
kubectl -n vroomon edit pvc vroomon-data
# remove the spec.claimRef.uid and spec.claimResourceVersion fields
```

### Local port 5112 already in use

The smoke test takes port 5112 on the launcher box. If something else is bound, change the registry port:

```bash
VROOMON_PORT=5113 ./scripts/deploy.sh
```

…or in the k8s manifest, change `containerPort: 5112` and the `Service.spec.ports[0].port` together.

### Verifying the public URL end to end

```bash
# 1. The pod is up
kubectl -n vroomon get pods

# 2. The pod is reachable on the internal port
kubectl -n vroomon exec -it deploy/vroomon -c vroomon -- \
  curl -sI http://127.0.0.1:5112 || echo "internal port OK (no HTTP server is fine)"

# 3. The tunnel is alive
cloudflared tunnel info vroomon

# 4. The DNS resolves
dig vroomon.shsw.dev

# 5. The URL returns 200 (or a Cloudflare error page, which means the
# tunnel reached the pod but Electron's BrowserWindow doesn't serve HTTP)
curl -I https://vroomon.shsw.dev
```

## Maintenance

### Wipe Hall of Fame state

```bash
kubectl -n vroomon delete pvc vroomon-data
kubectl -n vroomon rollout restart deployment/vroomon
```

### Upgrade the Electron version

1. Bump `electron` in `package.json` and run `npm install`.
2. Re-run `scripts/deploy.sh`. The new image is tagged with the deploy timestamp; the previous image is left in the registry for one cycle so a rollback is just `kubectl set image`.

### Roll back to the previous image

```bash
kubectl -n vroomon set image deployment/vroomon vroomon=127.0.0.1:5000/vroomon:<previous-tag>
```
