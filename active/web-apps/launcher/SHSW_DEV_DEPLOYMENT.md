# SHSW.dev Deployment Plan

All megarepo web apps are available under `*.shsw.dev` subdomains via Cloudflare Tunnels.

## Architecture

```
Internet → Cloudflare Edge → Cloudflare Tunnel → localhost:PORT → App
```

- **Domain**: `shsw.dev` (managed in Cloudflare)
- **Tunnel**: Each app has a Cloudflare Tunnel (or they share one tunnel with ingress rules)
- **SSL**: Automatic via Cloudflare
- **Backend**: Kubernetes cluster (thinker k3s) or local dev server
- **Registry**: Local container registry at `127.0.0.1:5000`

## Subdomain Registry

This is the single source of truth. Each app's `subdomain` field in [`apps.yaml`](apps.yaml) defines its public URL.

| App | Subdomain | Full URL | Type | Internal Port |
|-----|-----------|----------|------|---------------|
| Momos (Cozi) | `cozi` | https://cozi.shsw.dev | Flask | 5000 |
| Parambulator | `parambulator` | https://parambulator.shsw.dev | Flask | 5000 |
| Sub Day Generator | `sub` | https://sub.shsw.dev | Flask | 5000 |
| Vernissage | `gallery` | https://gallery.shsw.dev | Next.js | 3000 |
| Let's Hold 'em Together | `holdem` | https://holdem.shsw.dev | Flask | 5000 |
| Code Reviewdle | `codereviewdle` | https://codereviewdle.shsw.dev | Flask | 5000 |
| Conway's Game of War | `conway` | https://conway.shsw.dev | Flask | 5000 |
| Wizard Fight | `wizard` | https://wizard.shsw.dev | Flask+SocketIO | 5055 |
| Wizard Fight (Frontend) | `wizard-app` | https://wizard-app.shsw.dev | Static | 80 |
| Super Ultimate TCG | `tcg` | https://tcg.shsw.dev | Flask | 5000 |
| Powder Play (Mix) | `powder-api` | https://powder-api.shsw.dev | Node.js | 8787 |
| Powder Play (UI) | `powder` | https://powder.shsw.dev | Vite (static) | 80 |
| Hivemind LLM | `hivemind-api` | https://hivemind-api.shsw.dev | Flask+SocketIO | 5000 |
| Hivemind LLM (UI) | `hivemind` | https://hivemind.shsw.dev | Static (nginx) | 80 |
| Operationalize | `ops` | https://ops.shsw.dev | Flask | 5000 |

## Prerequisites

- **Cloudflare account** with `shsw.dev` zone added
- **cloudflared** installed on the deployment machine
- **Kubernetes cluster** (k3s on thinker) with ArgoCD or manual `kubectl`
- **Local container registry** running at `127.0.0.1:5000`

## Deployment Methods

### Method A: Kubernetes (preferred)

Each app has a k8s manifest in its `k8s/` directory with a `cloudflared` sidecar.

1. Build and push the image:
   ```bash
   cd apps/<app-dir>
   docker build -t 127.0.0.1:5000/<image-name>:latest .
   docker push 127.0.0.1:5000/<image-name>:latest
   ```

2. Create the Cloudflare tunnel token secret:
   ```bash
   kubectl -n <namespace> create secret generic <app>-cloudflared-token \
     --from-literal=token='<tunnel-token>'
   ```

3. Apply the manifest:
   ```bash
   kubectl apply -f k8s/<manifest>.yaml
   ```

4. In Cloudflare Zero Trust dashboard, add a public hostname:
   - Subdomain: `<subdomain>`
   - Domain: `shsw.dev`
   - Service: `http://localhost:<internal-port>`

### Method B: Local tunnel (dev)

Each app can run locally with a Cloudflare Tunnel for public access.

```bash
# Start the app
cd apps/<app-dir>
FLASK_DEBUG=false PORT=<port> HOST=127.0.0.1 \
  python -m <module> &

# Start tunnel
cloudflared tunnel --url http://localhost:<port>
```

## Cloudflare Tunnel Setup (first time for a new app)

### If using a shared tunnel with ingress rules:

1. Create or identify the shared tunnel:
   ```bash
   cloudflared tunnel list
   ```

2. Add an ingress rule to `/home/vscode/.cloudflared/config.yml`:
   ```yaml
   tunnel: <shared-tunnel-id>
   credentials-file: /home/vscode/.cloudflared/<shared-tunnel-id>.json

   ingress:
     - hostname: <subdomain>.shsw.dev
       service: http://localhost:<port>
     # ... keep existing rules ...
     - service: http_status:404
   ```

3. Restart cloudflared:
   ```bash
   systemctl restart cloudflared
   ```

### If using a dedicated tunnel (per app):

```bash
# Create tunnel
cloudflared tunnel create <app-name>

# Route DNS
cloudflared tunnel route dns <app-name> <subdomain>.shsw.dev

# Create config
# See the ingress pattern above

# Run tunnel
cloudflared tunnel run <app-name>
```

## Kubernetes Manifest Conventions

All k8s manifests follow these conventions:

- **Namespace**: Matches the app's subdomain (e.g., `cozi`, `holdem`, `wizard`)
- **Labels**: `app.kubernetes.io/name`, `app.kubernetes.io/part-of: shsw-dev`, `app.kubernetes.io/component`
- **Image registry**: `127.0.0.1:5000/<image>:latest`
- **Sidecar**: `cloudflared` with tunnel token from a Kubernetes secret
- **Container port**: Internal port the app listens on
- **Service port**: Same as container port

### Components label values

Use these consistent component labels:

| Component | Value |
|-----------|-------|
| Core web apps | `web-app` |
| Games | `game` |
| AI/ML tools | `ai` |
| Dev tools | `devtools` |

## Verifying Deployment

```bash
# Check pod status
kubectl -n <namespace> get pods

# Check service
kubectl -n <namespace> get svc

# Test via tunnel
curl -I https://<subdomain>.shsw.dev

# Check DNS propagation
dig <subdomain>.shsw.dev
```

## Adding a New App

1. Add the app to [`active/web-apps/launcher/apps.yaml`](apps.yaml) with an `icon`, `subdomain`, and launch config
2. Create a `k8s/<name>.yaml` manifest with the cloudflared sidecar pattern
3. Create a `Dockerfile`
4. Add a `DEPLOYMENT.md` with app-specific deployment steps
5. Update this document's subdomain registry table
