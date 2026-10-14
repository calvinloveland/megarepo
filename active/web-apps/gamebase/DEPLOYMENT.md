# Gamebase Deployment

Gamebase is hosted at **https://games.shsw.dev** and runs as a local Docker
container behind the `*.shsw.dev` Cloudflare Tunnel.

## Architecture

```
Internet ──▶ Cloudflare edge ──▶ cloudflared tunnel (systemd user service)
                                        │
                                        ▼
                             127.0.0.1:5121  →  gamebase container
                                        │
                    ┌───────────────────┴────────────────────┐
                    ▼                                        ▼
   /app/registry  ← mount: active/web-apps/gamebase/registry   /app/instance (SQLite)
```

- **Container**: `gamebase:local`, started by `scripts/deploy-local.sh`
  (`--restart unless-stopped`), published on `127.0.0.1:5121`.
- **Registry**: the repo's `registry/` directory is bind-mounted read/write, so
  dropping a game folder or using the hosted Remix/Push endpoints changes the
  repo files directly. `GAMEBASE_AUTO_RESCAN` makes new folders appear live.
- **Data**: the SQLite database lives in `~/.local/share/gamebase/` (a bind
  mount to `/app/instance`), outside the image so it survives rebuilds.
- **Tunnel**: `~/.config/systemd/user/cloudflared-shsw.service` runs
  `cloudflared --config ~/.cloudflared/config.yml tunnel run`, which maps
  `games.shsw.dev → http://127.0.0.1:5121`.

## Deploy / update

```bash
cd active/web-apps/gamebase
./scripts/deploy-local.sh          # build image, (re)start container, wait for health
```

Then verify:

```bash
curl -fsS https://games.shsw.dev/healthz
curl -fsS https://games.shsw.dev/api/games | head -c 200
```

The repo check runner can also build the image:

```bash
python scripts/build_docker.py gamebase
```

## Tunnel ingress

The public hostname is one entry in `~/.cloudflared/config.yml`:

```yaml
  - hostname: games.shsw.dev
    service: http://127.0.0.1:5121
```

DNS is a Cloudflare CNAME created once with:

```bash
cloudflared tunnel route dns a0e187ad-b0c8-499b-882a-32c25ff2730c games.shsw.dev
systemctl --user restart cloudflared-shsw.service
```

## Operations

```bash
docker logs -f gamebase                       # app logs
docker restart gamebase                       # restart app
systemctl --user status cloudflared-shsw      # tunnel status
journalctl --user -u cloudflared-shsw -f      # tunnel logs
```

## Notes

- The host runs **rootless** Docker, so files the container writes into the
  mounted registry are owned by `calvin` and can be committed normally.
- The k3s manifests used by some other apps are not used here: this host has no
  k3s cluster, so Gamebase uses the local Docker + tunnel path instead.
