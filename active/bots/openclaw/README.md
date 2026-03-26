# OpenClaw

Cluster-internal OpenClaw gateway deployment for the thinker k3s cluster.

## Files

- `k8s/openclaw.yaml` - Namespace, PVC, Deployment, and Service for the OpenClaw gateway.

## Secrets

Create the runtime secret in the `openclaw` namespace before applying the deployment:

```bash
kubectl -n openclaw create secret generic openclaw-env \
  --from-literal=openrouter-api-key='<OPENROUTER_API_KEY>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Deploy

```bash
kubectl apply -f active/bots/openclaw/k8s/openclaw.yaml
kubectl -n openclaw rollout status deploy/openclaw
kubectl -n openclaw get pods,svc,pvc
```

## Access

Keep the service internal and port-forward it when needed:

```bash
kubectl -n openclaw port-forward svc/openclaw 18789:18789
```

Then open `http://127.0.0.1:18789`.

## Notes

- The deployment intentionally uses `--auth none` because the service is cluster-internal only and expected to be reached through `kubectl port-forward`.
- The container installs `openclaw` onto the mounted PVC on first boot to avoid pulling the much larger all-in-one image on a disk-pressured node.
