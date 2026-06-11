# Recursive Thermofluid Sandbox Deployment

Public target:

- https://thermofluid.shsw.dev

## Current status

The app is registered in:

- `active/web-apps/launcher/apps.yaml`
- `~/.cloudflared/config.yml`

But the public hostname still requires a DNS route in Cloudflare for `thermofluid.shsw.dev`.

## Why the public URL was not up

Two things are required for a new `*.shsw.dev` app:

1. **Ingress rule** mapping `thermofluid.shsw.dev` to the local origin
2. **DNS record** routing that hostname into the Cloudflare tunnel

The ingress rule can be configured locally, but DNS creation requires Cloudflare credentials / origin cert access.

## Local origin

This app serves on:

- `http://127.0.0.1:5192`

Start it with:

```bash
cd /home/calvin/megarepo/active/web-apps/recursive-thermofluid-sandbox
npm run start
```

## Shared tunnel ingress rule

Add this to `~/.cloudflared/config.yml` above the catch-all rule:

```yaml
  - hostname: thermofluid.shsw.dev
    service: http://127.0.0.1:5192
```

Validate:

```bash
cloudflared tunnel ingress validate ~/.cloudflared/config.yml
```

Restart tunnel:

```bash
pkill -f 'cloudflared tunnel --config /home/calvin/.cloudflared/config.yml run'
nohup cloudflared tunnel --config /home/calvin/.cloudflared/config.yml run > /tmp/cloudflared.log 2>&1 &
```

## DNS route

After ingress is present, create the public DNS route:

```bash
cloudflared tunnel route dns a0e187ad-b0c8-499b-882a-32c25ff2730c thermofluid.shsw.dev
```

If `cloudflared` asks for an origin certificate, provide the Cloudflare-managed `cert.pem` or use a Cloudflare API credentialed environment.

## Kubernetes deployment

Files included:

- `Dockerfile`
- `k8s/recursive-thermofluid-sandbox.yaml`

Suggested release flow:

```bash
docker build -t 127.0.0.1:5000/recursive-thermofluid-sandbox:latest .
docker push 127.0.0.1:5000/recursive-thermofluid-sandbox:latest
kubectl create namespace thermofluid --dry-run=client -o yaml | kubectl apply -f -
kubectl -n thermofluid create secret generic thermofluid-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/recursive-thermofluid-sandbox.yaml
```

## Verification

```bash
npm test
curl -I http://127.0.0.1:5192
getent hosts thermofluid.shsw.dev
curl -I https://thermofluid.shsw.dev
```
