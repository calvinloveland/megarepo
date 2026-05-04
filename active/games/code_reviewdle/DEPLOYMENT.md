# Code Reviewdle Deployment

Target public URL: `https://codereviewdle.shsw.dev`

This app deploys to thinker using:

- a prebuilt image pushed to the thinker-local registry
- a Kubernetes deployment in the `codereviewdle` namespace
- a Cloudflare Tunnel sidecar for public access
- local cloudflared config + credentials secrets for the tunnel connector
- a persistent volume for feedback submissions

## Required secrets

Create or update these before the first rollout.

### App env secret

The manifest includes a placeholder `codereviewdle-env` secret. Replace the default values before exposing the app publicly.

### Feedback admin secret

```bash
kubectl -n codereviewdle create secret generic codereviewdle-feedback-auth \
  --from-literal=username='<admin-username>' \
  --from-literal=password='<admin-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Cloudflared local tunnel secrets

Create a local-source Cloudflare tunnel, then store both the config file and the credentials JSON used by `cloudflared tunnel run`.

```bash
kubectl -n codereviewdle create secret generic codereviewdle-cloudflared-config \
  --from-file=config.yml=./cloudflared-config.yml \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n codereviewdle create secret generic codereviewdle-cloudflared-credentials \
  --from-file=credentials.json=./cloudflared-credentials.json \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Build and deploy

```bash
cd active/games/code_reviewdle
./scripts/deploy-to-thinker.sh
```

Or publish the image without rolling the deployment:

```bash
./scripts/publish-to-thinker-registry.sh
```

## Cloudflare hostname note

The sidecar only keeps the tunnel connected. The public hostname still has to be attached to that tunnel in Cloudflare Zero Trust / DNS.

Make sure the tunnel has a public hostname for:

- `codereviewdle.shsw.dev`

## Verification

```bash
kubectl --kubeconfig "$HOME/.kube/thinker-k3s.yaml" -n codereviewdle get pods
kubectl --kubeconfig "$HOME/.kube/thinker-k3s.yaml" -n codereviewdle get svc codereviewdle
python - <<'PY'
import urllib.request
print(urllib.request.urlopen('https://codereviewdle.shsw.dev', timeout=10).status)
PY
```
