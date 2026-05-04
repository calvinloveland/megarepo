# Cozi

Prototype Flask app for a family command center that consolidates household logistics.

## What it does (prototype)

- Extracts likely action items from pasted school email text
- Organizes shared calendar events with an explicit responsibility tag
- Tracks pantry basics and generates a grocery gap list
- Builds a reminder queue from manual reminders plus due-dated email actions
- Stores kid profile details such as clothing and shoe sizes
- Uses the shared web feedback system (`/feedback`) with the floating feedback widget
- Includes multiple bold landing page concepts:
  - `/landing/neon-sprint`
  - `/landing/editorial-pop`
  - `/landing/midnight-luxe`

## Quickstart

```bash
cd active/web-apps/momos
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
python -m momos.app
```

Open: http://127.0.0.1:5000

Use `/` to browse landing concepts and `/workspace` for the working Cozi dashboard form.

## Tests

```bash
cd active/web-apps/momos
pip install -e .[dev]
python -m pytest -q
```

## Hosting

- Docker: `Dockerfile` + `docker-compose.yml`
- Cloudflare tunnel helper: `tunnel.sh`
- Kubernetes manifest: `k8s/cozi.yaml`
- Deployment guide: [DEPLOYMENT.md](DEPLOYMENT.md)

## Feedback Admin Access

`GET /feedback` and `POST /feedback/mark-addressed` require:
- `FEEDBACK_ADMIN_USERNAME`
- `FEEDBACK_ADMIN_PASSWORD`

## Next Prototype Steps

- Add Gmail/Google Calendar connectors behind explicit OAuth consent
- Add recurring reminders and household role templates
- Add saved household profiles and exportable weekly plan summaries
