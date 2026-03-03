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

Point ArgoCD at this directory path:
- Repo: `https://github.com/calvinloveland/megarepo.git`
- Revision: `main`
- Path: `active/web-apps/momos/k8s`

## Notes

- The Kubernetes deployment uses the same git-sync-on-restart pattern as Parambulator.
- The cloudflared sidecar explicitly sets `--url http://localhost:5000` to avoid 503 origin routing failures.
- For local development, use the project venv + `python -m momos.app`.
