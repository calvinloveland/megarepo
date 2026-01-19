# Deploy Wizard Fight (Single VPS)

## Prereqs
- Ubuntu 22.04+ with Python 3.11, Node 18+ installed
- Firewall allowing ports 5000 (API) and 5173 (frontend dev) or your chosen reverse proxy

## Backend
```bash
cd /opt/wizard_fight
python -m venv .venv
. .venv/bin/activate
pip install .
python -m wizard_fight.server
```

## Frontend
```bash
cd /opt/wizard_fight/frontend
npm install
npm run build
```

Serve the built frontend with Nginx or a simple static server.

## Systemd (Example)
Create `/etc/systemd/system/wizard-fight.service`:
```
[Unit]
Description=Wizard Fight Server
After=network.target

[Service]
WorkingDirectory=/opt/wizard_fight
ExecStart=/opt/wizard_fight/.venv/bin/python -m wizard_fight.server
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable wizard-fight
sudo systemctl start wizard-fight
```
