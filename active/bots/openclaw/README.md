# OpenClaw

Cluster-internal OpenClaw gateway deployment for the thinker k3s cluster.

## Files

- `k8s/openclaw.yaml` - Namespace, PVC, Deployment, and Service for the OpenClaw gateway.

## Secrets

Create the runtime secret in the `openclaw` namespace before applying the deployment:

```bash
kubectl -n openclaw create secret generic openclaw-env \
  --from-literal=openrouter-api-key='<OPENROUTER_API_KEY>' \
  --from-literal=telegram-bot-token='<TELEGRAM_BOT_TOKEN>' \
  --from-literal=gmail-address='<GMAIL_ADDRESS>' \
  --from-literal=gmail-app-password='<GMAIL_APP_PASSWORD>' \
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

## Tailscale access

If `thinker` is running the user-level Tailscale Serve proxy, the Control UI is also reachable at:

`https://thinker-openclaw.tail876a6b.ts.net`

Because the gateway uses token auth, bootstrap the UI with a tokenized dashboard URL:

```bash
TOKEN=$(kubectl -n openclaw get secret openclaw-env -o go-template='{{index .data "gateway-token"}}' | base64 -d)
printf 'https://thinker-openclaw.tail876a6b.ts.net/#token=%s\n' "$TOKEN"
```

Open the printed URL once in your browser. After that, the Control UI keeps the token in session storage for that browser tab session.

If the user-level Tailscale Serve proxy on `thinker` ever starts returning TLS errors or a blank/404-ish failure before the OpenClaw UI loads, make sure the userspace daemon was started with a writable `--statedir` in addition to `--state`. HTTPS cert issuance for Serve fails without it and logs `no TailscaleVarRoot`.

## Telegram

The deployment enables the Telegram Bot API channel when the `telegram-bot-token` secret key is present.

DM access is configured with `dmPolicy: "pairing"` by default, so the first DM from a new Telegram user will need approval before the bot replies.

## Gmail / email

The deployment also supports optional Gmail access through the bundled `himalaya` skill.

When both `gmail-address` and `gmail-app-password` secret keys are present, the pod installs `himalaya`, writes `~/.config/himalaya/config.toml`, and exposes email actions to OpenClaw through the existing bundled skill.

For Gmail, use a Google App Password rather than the main account password. This requires Google 2-Step Verification to be enabled first.

## Notes

- The container installs `openclaw` onto the mounted PVC on first boot to avoid pulling the much larger all-in-one image on a disk-pressured node.
