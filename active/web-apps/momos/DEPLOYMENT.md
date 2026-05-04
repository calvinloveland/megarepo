# Cozi Deployment

Deployment options mirror the Parambulator setup: Docker Compose, Cloudflare tunnel script, and Kubernetes + ArgoCD manifest.

## Docker Compose

```bash
cd active/web-apps/momos
docker-compose up -d --build
docker-compose logs -f
```

App is available at `http://127.0.0.1:5002`.

## Cloudflare Tunnel Script

Use `tunnel.sh` for quick local + tunnel management:

```bash
cd active/web-apps/momos
chmod +x tunnel.sh
./tunnel.sh start
./tunnel.sh status
./tunnel.sh logs
./tunnel.sh stop
```

Before first run, update these values in `tunnel.sh`:
- `TUNNEL_NAME`
- `PUBLIC_URL`

If your Cloudflare config path is not `$HOME/.cloudflared/config.yml`, set:

```bash
export CF_CONFIG=/path/to/config.yml
```

## Kubernetes + ArgoCD

Manifest: `k8s/cozi.yaml`

The cluster manifest now expects a prebuilt image from the thinker-local registry instead of downloading source from GitHub at pod startup.

Create tunnel token secret:

```bash
kubectl -n cozi create secret generic cozi-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Apply resources:

```bash
kubectl apply -f k8s/cozi.yaml
kubectl -n cozi get pods
kubectl -n cozi get svc cozi
```

Build and roll a new image with:

```bash
./scripts/deploy-to-thinker.sh
```

Or publish without rolling the deployment:

```bash
./scripts/publish-to-thinker-registry.sh
```

Point ArgoCD at this directory path:
- Repo: `https://github.com/calvinloveland/megarepo.git`
- Revision: `main`
- Path: `active/web-apps/momos/k8s`

## Notes

- The Kubernetes deployment now uses prebuilt images rather than runtime git sync.
- The cloudflared sidecar explicitly sets `--url http://localhost:5000` to avoid 503 origin routing failures.
- For local development, use the project venv + `python -m momos.app`.
