# Vernissage

Art review web app in the megarepo's `active/web-apps/` collection.

`Vernissage` is a Goodreads/Letterboxd-style social catalog for visual art with an Art Nouveau interface inspired by *The Gilded Manuscript* design brief in `/home/calvin/Downloads/art_nouveau.md`.

## What the launch build includes

- Art Nouveau visual system with parchment texture, emerald-and-gold palette, botanical ornaments, asymmetrical layouts, and serif-led typography
- Browse and detail surfaces for artworks, artists, and exhibitions
- A review composer for artworks, artists, exhibitions, and museum visits
- Member profiles, lists, and an activity feed
- Prisma schema covering the planned social/domain model
- Museum API ingestion scripts for the Met, Art Institute of Chicago, and Rijksmuseum
- Demo-content validation tests runnable without installing application dependencies

## Stack

- Next.js App Router
- TypeScript
- Prisma + PostgreSQL
- SQLite-backed feedback storage on the persistent `/data` volume
- NextAuth.js credentials auth backed by Prisma users

## Getting started

```bash
cd active/web-apps/vernissage
cp .env.example .env.local
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Environment variables

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/vernissage"
FEEDBACK_DATABASE_URL="file:./data/vernissage-feedback.db"
NEXTAUTH_URL="http://127.0.0.1:3000"
NEXTAUTH_SECRET="replace-me"
RIJKSMUSEUM_API_KEY="replace-me-if-using-import:rijks"
FEEDBACK_ADMIN_USERNAME="admin"
FEEDBACK_ADMIN_PASSWORD="replace-me"
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:e2e
npm run test:all
npm run import:met
npm run import:aic
npm run import:rijks
./scripts/verify-live.sh
```

## Testing

The test suite now has two layers:

```bash
npm test
npm run test:e2e
```

`npm test` runs Node-native unit and content-integrity checks that cover:

- catalog helper behavior such as mosaic selection and IIIF thumbnail resolution
- feedback helper behavior such as path normalization and filename round-tripping
- artwork, artist, exhibition, venue, review, and list references remain consistent
- referenced artwork and ornament assets exist
- the demo feed only points at valid members and paths

`npm run test:e2e` runs Playwright smoke coverage against a local Next.js server, including homepage rendering and key navigation flows into artwork, artist, exhibition, and member pages.

## Accounts and review persistence

Vernissage now includes:

- `/join` for account creation
- `/signin` for account access
- `/api/reviews` for persisted review submission
- `/api/health` and `/api/ready` for app/runtime checks

These routes require `DATABASE_URL` to be configured. When the database URL is absent, the site stays readable but account creation and publishing are intentionally disabled.

Launch abuse protections now include a one-review-per-user-per-target guard plus basic in-memory rate limiting on review publication and feedback/admin write paths.

## Feedback system

Vernissage now includes a floating, Art Nouveau-styled feedback widget wired to the shared web-app feedback contract:

- `POST /feedback`
- `GET /feedback` with basic auth
- `POST /feedback/mark-addressed` with basic auth

Feedback is stored in `data/vernissage-feedback.db`. On startup, Vernissage imports any legacy JSON feedback from `data/feedback/*.json` and `data/feedback/addressed/*.json` so older submissions remain visible.

For local feedback development, make sure `sqlite3` is installed on the machine running the Next.js server.

## Kubernetes

A cluster manifest is provided at `k8s/vernissage.yaml`, and the app now has a container build at `Dockerfile`.

It deploys the app with:

- a persistent volume for the feedback database and any legacy feedback files
- secret-backed NextAuth and feedback-admin configuration
- a prebuilt container image instead of downloading and building source inside the pod
- `/api/ready` for readiness checks and `/api/health` for liveness checks
- resource requests/limits plus non-root execution for the app container
- a `cloudflared` sidecar driven by the `vernissage-cloudflared-token` secret

Public hostname:

```text
https://vernissage.shsw.dev
```

Create the tunnel token secret with:

```bash
kubectl -n vernissage create secret generic vernissage-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Container validation is defined in `.github/workflows/vernissage-container.yml`.

For the live thinker deployment, Vernissage now uses a private registry running on the thinker host at `127.0.0.1:5000`. The registry stays private to the machine, and k3s pulls the image from that loopback address.

Use:

```bash
./scripts/publish-to-thinker-registry.sh
./scripts/deploy-to-thinker.sh
```

The deploy helper:

- ensures the private registry container is running on thinker
- streams the current source tree to thinker and builds the image there from `active/web-apps/vernissage/Dockerfile`
- pushes both an immutable timestamp tag and `latest` into the thinker-local registry
- applies the non-secret resources from `k8s/vernissage.yaml`, updates `APP_VERSION`, and rolls the deployment

The placeholder `Secret` objects in `k8s/vernissage.yaml` are bootstrap examples only. The deploy helper intentionally preserves the live cluster secrets so real database and auth credentials are not overwritten by placeholder values.

The GitHub Actions workflow now validates the app and confirms the Docker image still builds cleanly, but live publishing happens through the thinker-local registry path rather than GHCR.

## Prelaunch checklist, backup, and rollback

Repeatable live verification:

```bash
./scripts/verify-live.sh
```

Backup the live Postgres data:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage exec deploy/vernissage-postgres -- \
  pg_dump -U vernissage vernissage > vernissage-prelaunch.sql
```

Copy the feedback SQLite database:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage cp \
  $(kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage get pod -l app=vernissage -o jsonpath='{.items[0].metadata.name}'):/data/vernissage-feedback.db \
  ./vernissage-feedback-prelaunch.db
```

Rollback the app deployment if a release goes bad:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage rollout undo deployment/vernissage
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage rollout status deployment/vernissage
```

Cluster secrets should be rotated in place rather than edited in `k8s/vernissage.yaml`, which intentionally keeps placeholder bootstrap examples only.

The deployed service is exposed on thinker at:

```text
http://192.168.1.191:30030
```

Over Tailscale, you can also use:

```text
http://100.99.147.74:30030
```

Cluster verification used:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml -n vernissage port-forward svc/vernissage 3002:3000
curl http://127.0.0.1:3002/
curl -X POST http://127.0.0.1:3002/feedback ...
curl -u admin:secret http://127.0.0.1:3002/feedback
```

## Accessibility and quality bar

- preserve artwork aspect ratios; never crop paintings into square thumbnails
- ensure decorative SVGs are `aria-hidden` unless they carry meaning
- maintain AA contrast for text against parchment and emerald surfaces
- simplify ornament density on tablet/mobile while preserving palette, texture, and typography
- treat botanical flourishes as enhancement, not the only cue for structure or focus
