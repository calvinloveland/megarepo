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
  --from-literal=hooks-token='<OPENCLAW_HOOKS_TOKEN>' \
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

The secure Gmail path for this deployment is the official Gmail Pub/Sub webhook flow with Google OAuth read-only scopes.

The cluster deployment enables OpenClaw hooks and the built-in Gmail preset at `/hooks/gmail`. Use a dedicated `hooks-token`; do not reuse the gateway token.

The Gmail watcher itself runs outside the pod with `gog` + `gcloud`, then posts into the gateway hook endpoint. This keeps Gmail access on OAuth with `gmail.readonly` and avoids storing an app password in the cluster.

High-level flow:

1. Authorize `gog` against the Gmail account with `--gmail-scope=readonly`.
2. Enable `gmail.googleapis.com` and `pubsub.googleapis.com` in the Google Cloud project that owns the OAuth client.
3. Create a Pub/Sub topic and push subscription.
4. Run `gog gmail watch serve` on `thinker`, pointing `--hook-url` at the OpenClaw gateway’s `/hooks/gmail` endpoint and authenticating with `--hook-token`.
5. Expose the watcher’s public HTTPS endpoint with Tailscale Funnel so Google Pub/Sub can reach it.

This secure path only covers new-mail events. It does not grant broad historical inbox browsing the way IMAP would.

## Notes

- The container installs `openclaw` onto the mounted PVC on first boot to avoid pulling the much larger all-in-one image on a disk-pressured node.
