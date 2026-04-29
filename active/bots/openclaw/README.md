# OpenClaw

Cluster-internal OpenClaw gateway deployment for the thinker k3s cluster.

## Files

- `k8s/openclaw.yaml` - Namespace, PVC, Deployment, and Service for the OpenClaw gateway.
- `scripts/manage_thinker_proxy.py` - Starts and inspects the thinker-side `kubectl port-forward` plus the userspace Tailscale Serve proxy.

## Secrets

Create the runtime secret in the `openclaw` namespace before applying the deployment:

```bash
kubectl -n openclaw create secret generic openclaw-env \
  --from-literal=openrouter-api-key='<OPENROUTER_API_KEY>' \
  --from-literal=telegram-bot-token='<TELEGRAM_BOT_TOKEN>' \
  --from-literal=brave-api-key='<BRAVE_API_KEY>' \
  --from-literal=hooks-token='<OPENCLAW_HOOKS_TOKEN>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

`brave-api-key` is optional. Omit it if you do not want the extra Brave search provider.

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

If `thinker` is running the user-level Tailscale Serve proxy, the Control UI is reachable privately on the tailnet at:

`https://thinker-openclaw.tail876a6b.ts.net:8443`

Because the gateway uses token auth, bootstrap the UI with a tokenized dashboard URL:

```bash
TOKEN=$(kubectl -n openclaw get secret openclaw-env -o go-template='{{index .data "gateway-token"}}' | base64 -d)
  printf 'https://thinker-openclaw.tail876a6b.ts.net:8443/#token=%s\n' "$TOKEN"
```

Open the printed URL once in your browser. After that, the Control UI keeps the token in session storage for that browser tab session.

The preferred way to keep that proxy healthy on `thinker` is:

```bash
python3 active/bots/openclaw/scripts/manage_thinker_proxy.py start
```

That helper starts two local processes on `thinker`:

1. `kubectl -n openclaw port-forward --address 127.0.0.1 svc/openclaw 18789:18789`
2. `tailscaled --tun=userspace-networking` with both a persistent `--state` file and a writable `--statedir`, then `tailscale serve --bg --https 8443 http://127.0.0.1:18789`

If the tailnet URL ever starts returning TLS errors or a blank/404-ish failure before the OpenClaw UI loads, run the helper again. The root cause is usually a userspace Tailscale daemon that was launched with `--state` but without a writable `--statedir`, which breaks certificate issuance for Serve and logs `no TailscaleVarRoot`.

Useful helper commands:

```bash
python3 active/bots/openclaw/scripts/manage_thinker_proxy.py status
python3 active/bots/openclaw/scripts/manage_thinker_proxy.py stop
```

The helper keeps logs, pid files, and Tailscale userspace state under `~/.local/state/openclaw-proxy/`.

## Telegram

The deployment enables the Telegram Bot API channel when the `telegram-bot-token` secret key is present.

DM access is configured with `dmPolicy: "pairing"` by default, so the first DM from a new Telegram user will need approval before the bot replies.

## Gmail / email

The secure Gmail path for this deployment is the official Gmail Pub/Sub webhook flow with Google OAuth read-only scopes.

The cluster deployment enables OpenClaw hooks at `/hooks/gmail` with a custom wake mapping instead of the built-in “summarize every email” preset. Use a dedicated `hooks-token`; do not reuse the gateway token.

The Gmail watcher itself runs outside the pod with `gog` + `gcloud`, then posts into the gateway hook endpoint. This keeps Gmail access on OAuth with `gmail.readonly` and avoids storing an app password in the cluster.

High-level flow:

1. Authorize `gog` against the Gmail account with `--gmail-scope=readonly`.
2. Enable `gmail.googleapis.com` and `pubsub.googleapis.com` in the Google Cloud project that owns the OAuth client.
3. Create a Pub/Sub topic and push subscription.
4. Run `gog gmail watch serve` on `thinker`, pointing `--hook-url` at the OpenClaw gateway’s `/hooks/gmail` endpoint and authenticating with `--hook-token`.
5. Expose the watcher’s public HTTPS endpoint with Tailscale Funnel so Google Pub/Sub can reach it.

This secure path only covers new-mail events. It does not grant broad historical inbox browsing the way IMAP would.

### Gmail triage behavior

On startup, the deployment rewrites the live workspace `HEARTBEAT.md` so inbox events are triaged quietly:

- every inbound message is recorded in a recent-inbox ledger under `memory/email/YYYY-MM-DD.md`
- routine promotions, newsletters, and low-signal automated mail stay silent
- important but non-actionable mail is recorded in `memory/YYYY-MM-DD.md`
- only important mail that likely needs Calvin's attention triggers a user-facing alert

This prevents the old behavior where every inbound message was summarized back into the main chat flow while still giving the main agent a read-only record of recent inbox activity it can consult later.

On startup, the deployment also appends a short `AGENTS.md` note so the main agent knows to read recent `memory/email/` files before claiming it cannot see email.

For safety, keep the OpenClaw Control UI on a tailnet-only Serve port and reserve Funnel for the Gmail webhook endpoint only. Do not Funnel the Control UI root.

## Browser automation

The deployment installs Debian `chromium` inside the pod and configures the OpenClaw-managed browser profile to run in headless, `noSandbox` mode. That matches the container environment on `thinker`, where there is no desktop session and Chromium sandboxing is not usable as root.

On startup, the pod also removes stale Chromium `Singleton*` lock files from the persistent OpenClaw browser profile. That matters on this PVC-backed deployment because crashed or replaced pods can otherwise leave the shared profile in a permanently "already running" state.

Fresh pod starts can take significantly longer than a couple of minutes before readiness goes green because the container installs `chromium` into the ephemeral filesystem before launching the gateway. The deployment therefore uses a long startup probe window and disables rollout surge so only one expensive startup runs on the single thinker node at a time.

The startup script now writes the full `openclaw.json` in one shot instead of chaining many `openclaw config set ...` mutations at boot. That keeps the pod from stalling in `openclaw-config` before the gateway ever binds its health port.

## Model fallback

The deployment keeps `openrouter/free` as the primary default model and configures `github-copilot/gpt-4.1` as the first fallback.

The GitHub Copilot provider requires an interactive device login (`openclaw models auth login-github-copilot`) and stores the resulting auth profile in the persistent OpenClaw state. Once that profile exists on the PVC, restarts keep the fallback available.

## Web search providers

The deployment now defaults `web_search` to DuckDuckGo so the agent has a free search provider available out of the box.

You can also expose the other upstream-documented free options:

- `brave-api-key`: enables Brave Search with its free monthly credit tier

The deployment pre-enables the bundled `duckduckgo` and `brave` search plugins so those provider switches work without additional image changes.

DuckDuckGo remains the baked-in default on every pod start. If you want to switch providers live inside the running pod, use:

```bash
kubectl -n openclaw exec deploy/openclaw -- sh -lc '
  export HOME=/data/home OPENCLAW_STATE_DIR=/data/.openclaw
  openclaw config set tools.web.search.provider brave
'
```

Replace `brave` with `duckduckgo` as needed. Because the deployment rewrites its baseline config at startup, those live changes are temporary; edit `k8s/openclaw.yaml` if you want a different persistent default.

Although newer upstream OpenClaw docs mention SearXNG, the pinned deployment version here (`openclaw@2026.3.24`) does not ship a bundled `searxng` plugin, so this deployment intentionally exposes only the free providers that are actually available in that build.

## Notes

- The container installs `openclaw` onto the mounted PVC on first boot to avoid pulling the much larger all-in-one image on a disk-pressured node.
