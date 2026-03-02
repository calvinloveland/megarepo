# Sub Day Generator Deployment

Deployment options mirror the Parambulator setup: Docker Compose, Cloudflare tunnel script, and Kubernetes + ArgoCD manifest.

## Docker Compose

```bash
cd active/web-apps/sub-day-generator
docker-compose up -d --build
docker-compose logs -f
```

App is available at `http://127.0.0.1:5001`.

## Cloudflare Tunnel Script

Use `tunnel.sh` for quick local + tunnel management:

```bash
cd active/web-apps/sub-day-generator
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

Manifest: `k8s/sub-day-generator.yaml`

Create tunnel token secret:

```bash
kubectl -n sub-day-generator create secret generic sub-day-generator-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Apply resources:

```bash
kubectl apply -f k8s/sub-day-generator.yaml
kubectl -n sub-day-generator get pods
kubectl -n sub-day-generator get svc sub-day-generator
```

## Notes

- The Kubernetes deployment uses the same git-sync-on-restart pattern as Parambulator.
- For local development, use the project venv + `python -m sub_day_generator.app`.
