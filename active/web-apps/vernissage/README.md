# Vernissage

Art review web app in the megarepo's `active/web-apps/` collection.

`Vernissage` is a Goodreads/Letterboxd-style social catalog for visual art with an Art Nouveau interface inspired by *The Gilded Manuscript* design brief in `/home/calvin/Downloads/art_nouveau.md`.

## What the launch build includes

- Art Nouveau visual system with parchment texture, emerald-and-gold palette, botanical ornaments, asymmetrical layouts, and serif-led typography
- Browse and detail surfaces for artworks, artists, and exhibitions
- A review composer for artworks, artists, exhibitions, and museum visits
- Artwork-page quick saves for favoriting pieces and jotting private notes on the current device
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
ANALYTICS_DATABASE_URL="file:./data/vernissage-analytics.db"
NEXTAUTH_URL="http://127.0.0.1:3000"
NEXTAUTH_SECRET="replace-me"
RIJKSMUSEUM_API_KEY="replace-me-if-using-import:rijks"
FEEDBACK_ADMIN_HANDLES="curatorbot"
APP_VERSION="dev"
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
npm run import:monet
npm run import:catalogs
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
- `/artists/new` for direct artist suggestion requests
- `/api/reviews` for persisted review submission
- `/api/analytics` for first-party event collection
- `/api/analytics/summary` for admin-only analytics summaries
- `/api/health` and `/api/ready` for app/runtime checks

These routes require `DATABASE_URL` to be configured. When the database URL is absent, the site stays readable but account creation and publishing are intentionally disabled.

Signup is intentionally minimal: the live `/join` form only asks for a handle and password, and the handle becomes the initial public display name until a richer profile-editing flow exists.

Password security: user passwords are stored as salted `scrypt` hashes, and environments that enable auth must set a real `NEXTAUTH_SECRET`. The current join flow enforces a minimum password length of 12 characters.

Launch abuse protections now include a one-review-per-user-per-target guard plus basic in-memory rate limiting on review publication and feedback/admin write paths.

Favorite artworks and favorite artists are meant to be public, database-backed member-page signals rather than browser-only state. The artwork-page `+` control now stays focused on private notes stored in browser local storage for now.

Member pages are also the home for public social graph signals: once the shared application database is connected, signed-in users can follow other members directly from profile pages.

Vernissage now includes privacy-light, first-party analytics for page views, search usage, joins, sign-ins, favorites, follows, review publishing, and feedback submission. Event collection writes to the local analytics SQLite database, while the summary endpoint is restricted to signed-in admin handles.

The static catalog now ships without seeded reviews, feed entries, lists, members, exhibition activity, or artwork star aggregates. Homepage/community surfaces pull from persisted user reviews when they exist and otherwise render honest empty states instead of filler content.

Catalog policy: Vernissage should only include artists and works that can be reasonably represented on image-first catalog pages. Pure performance art and similar work that mainly survives as documentation rather than a stable visual object should stay out of the catalog.

Browse and artist pages should stay image-first as the catalog grows: if someone clicks into an artist, the illustrated works should still be visually obvious rather than buried under long text summaries.

That image-first rule does **not** mean every catalog record needs an image before it can exist. Deep artist dossiers can include text-only catalog records with honest "image not yet published" states so the work list can grow toward a real catalogue raisonne without pretending missing media exists.

For catalog additions, prefer Art Institute of Chicago public-domain works first because the app already supports `artic.edu` IIIF URLs directly. If a work has to come from another museum, keep it local under `public/artworks/` and only use clearly open/public-domain assets.

For very deep dossier expansions such as Claude Monet, use `npm run import:monet` to refresh the dedicated Monet supplement from Wikidata. To fan that same pattern out across the rest of the roster, use `npm run import:catalogs`, which builds per-artist supplemental files for the current catalog artists when Wikidata has reliable work records for them. The generated records intentionally keep public-domain factual metadata (title/year/medium when available) separate from image publication, so browse surfaces stay honest while the catalog grows.

`APP_VERSION` is surfaced in the site footer and feedback records so users and operators can see which deployment is live.

## Feedback system

Vernissage now includes a floating, Art Nouveau-styled feedback widget wired to the shared web-app feedback contract:

- `POST /feedback`
- `GET /feedback` for signed-in admin handles
- `POST /feedback/mark-addressed` for signed-in admin handles
- `POST /feedback/update` for signed-in admin handles
- `/feedback/updates` for member-facing progress tracking

Feedback is stored in `data/vernissage-feedback.db`. On startup, Vernissage imports any legacy JSON feedback from `data/feedback/*.json` and `data/feedback/addressed/*.json` so older submissions remain visible.

Feedback admin access now uses the normal Vernissage session plus the comma-separated `FEEDBACK_ADMIN_HANDLES` allowlist instead of HTTP Basic Auth credentials.

Feedback progress is now explicit instead of binary. Each note can move through `open`, `planned`, `in_progress`, and `shipped`, can carry a progress note, and can be assigned to the member handle responsible for the fix.

Signed-in members can track their attributed notes at `/feedback/updates`. Anonymous submissions are still supported; they return a private tracking link that resolves to the same updates page with a secure token.

For local feedback development, make sure `sqlite3` is installed on the machine running the Next.js server.

The feedback admin endpoints are rate limited. If you are triaging a long batch of production feedback and hit that limit, inspect the live SQLite queue directly:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml --server=https://100.99.147.74:6443 --insecure-skip-tls-verify=true \
  -n vernissage exec deploy/vernissage -- \
  sqlite3 /data/vernissage-feedback.db 'SELECT id, addressed, server_timestamp, feedback_text FROM feedback_records ORDER BY server_timestamp DESC;'
```

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

For a normal production release, use:

```bash
./scripts/deploy-to-thinker.sh
```

The deploy helper already calls `./scripts/publish-to-thinker-registry.sh` for you. Use the publish script separately only when you want to pre-stage images without rolling the live deployment.

Manual two-step usage remains available:

```bash
./scripts/publish-to-thinker-registry.sh
./scripts/deploy-to-thinker.sh
```

The deploy helper:

- ensures the private registry container is running on thinker
- streams the current source tree to thinker and builds the image there from `active/web-apps/vernissage/Dockerfile`
- pushes both an immutable timestamp tag and `latest` into the thinker-local registry
- applies the non-secret resources from `k8s/vernissage.yaml`, updates `APP_VERSION`, and rolls the deployment

If you are running kubectl from an off-LAN machine over Tailscale, the kubeconfig may still point at thinker's LAN IP. In that case, override the API server to the Tailscale address and skip TLS hostname verification for the session:

```bash
kubectl --kubeconfig ~/.kube/thinker-k3s.yaml --server=https://100.99.147.74:6443 --insecure-skip-tls-verify=true -n vernissage get pods
```

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

- preserve artwork aspect ratios; never crop paintings into square thumbnails, and let single-artwork pages use the highest-resolution source available
- ensure decorative SVGs are `aria-hidden` unless they carry meaning
- maintain AA contrast for text against parchment and emerald surfaces
- simplify ornament density on tablet/mobile while preserving palette, texture, and typography
- treat botanical flourishes as enhancement, not the only cue for structure or focus
