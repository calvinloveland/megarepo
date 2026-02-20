# Parambulator Cloudflare Tunnel Deployment

**Status**: ✅ Live at https://parambulator.shsw.dev  
**Date**: February 7, 2026  
**Tunnel ID**: `4cdefe39-9519-41ac-8d7b-d21d975c3df0`

## Architecture

```
Internet → Cloudflare Edge → Tunnel → localhost:5000 → Flask App
```

- **Domain**: parambulator.shsw.dev
- **Backend**: Flask development server on 127.0.0.1:5000
- **Tunnel**: cloudflared daemon with automatic failover
- **SSL/TLS**: Handled by Cloudflare (automatic HTTPS)

## Quick Management

Use the provided script for easy management:

```bash
# Check status
./tunnel.sh status

# View logs
./tunnel.sh logs

# Restart services
./tunnel.sh restart

# Stop everything
./tunnel.sh stop

# Start everything
./tunnel.sh start
```

## Kubernetes + ArgoCD (cluster deployment)

ArgoCD now watches `active/web-apps/parambulator/k8s/` and applies:
- `k8s/parambulator.yaml` (Parambulator Deployment + Service + cloudflared sidecar)

Create the cloudflared tunnel token secret in the `parambulator` namespace (never commit or log this token):

```bash
kubectl -n parambulator create secret generic parambulator-cloudflared-token \
  --from-literal=token='<cloudflared-tunnel-token>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Set feedback admin credentials for online feedback review routes:

```bash
kubectl -n parambulator create secret generic parambulator-feedback-auth \
  --from-literal=username='<feedback-admin-username>' \
  --from-literal=password='<feedback-admin-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Then verify:

```bash
kubectl -n parambulator get pods
kubectl -n argocd get application parambulator
```

## Manual Commands

### Start Services

```bash
# Start Parambulator
cd /workspaces/megarepo/active/web-apps/parambulator
SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") \
FLASK_DEBUG=false PORT=5000 HOST=127.0.0.1 \
nohup python -m parambulator.app > /tmp/parambulator.log 2>&1 &
echo $! > /tmp/parambulator.pid

# Start tunnel
nohup cloudflared tunnel --config /home/vscode/.cloudflared/config.yml run parambulator > /tmp/cloudflared.log 2>&1 &
echo $! > /tmp/cloudflared.pid
```

### Stop Services

```bash
kill $(cat /tmp/parambulator.pid)
kill $(cat /tmp/cloudflared.pid)
```

### Check Status

```bash
ps aux | grep -E "(parambulator|cloudflared)" | grep -v grep
curl -I http://localhost:5000
```

## Configuration Files

### Tunnel Config
**Location**: `/home/vscode/.cloudflared/config.yml`

```yaml
tunnel: 4cdefe39-9519-41ac-8d7b-d21d975c3df0
credentials-file: /home/vscode/.cloudflared/4cdefe39-9519-41ac-8d7b-d21d975c3df0.json

ingress:
  - hostname: parambulator.shsw.dev
    service: http://localhost:5000
  - service: http_status:404
```

### Tunnel Credentials
**Location**: `/home/vscode/.cloudflared/4cdefe39-9519-41ac-8d7b-d21d975c3df0.json`  
⚠️ **Keep this file secret** - contains tunnel authentication token

### Certificate
**Location**: `/home/vscode/.cloudflared/cert.pem`  
Cloudflare origin certificate for account authentication

## DNS Configuration

DNS record created automatically via `cloudflared tunnel route dns`:

```
parambulator.shsw.dev → CNAME → 4cdefe39-9519-41ac-8d7b-d21d975c3df0.cfargotunnel.com
```

## Logs

- **Parambulator**: `/tmp/parambulator.log`
- **Cloudflare Tunnel**: `/tmp/cloudflared.log`

```bash
# Follow logs in real-time
tail -f /tmp/parambulator.log /tmp/cloudflared.log

# View recent logs
tail -100 /tmp/parambulator.log
tail -100 /tmp/cloudflared.log
```

## Security Notes

### Current Setup
- ✅ HTTPS enforced by Cloudflare (automatic)
- ✅ CSRF protection enabled (Flask-WTF)
- ✅ Debug mode disabled (`FLASK_DEBUG=false`)
- ✅ Secure session cookies configured
- ✅ Input validation and bounds checking
- ✅ Path traversal prevention
- ⚠️  No authentication (suitable for trusted users only)
- ⚠️  Using Flask development server (consider Gunicorn for production)

### Recommendations for Production
1. **Add authentication** - See SECURITY_HARDENING_PLAN.md Phase 2
2. **Switch to Gunicorn** - See README.md Production Deployment section
3. **Enable rate limiting** - Protect against abuse
4. **Add monitoring** - Track uptime and errors

## Upgrading to Gunicorn

For better performance and stability:

```bash
# Install if not already installed
pip install gunicorn

# Update tunnel.sh start command to use:
SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") \
gunicorn -w 4 -b 127.0.0.1:5000 "parambulator.app:create_app()" \
  --log-file /tmp/parambulator.log \
  --daemon \
  --pid /tmp/parambulator.pid
```

## Troubleshooting

### Service Not Starting

```bash
# Check logs for errors
tail -50 /tmp/parambulator.log
tail -50 /tmp/cloudflared.log

# Verify port is not in use
lsof -i :5000

# Test app directly
cd /workspaces/megarepo/active/web-apps/parambulator
FLASK_DEBUG=true python -m parambulator.app
```

### Tunnel Connection Issues

```bash
# Check tunnel status
cloudflared tunnel info parambulator

# List all tunnels
cloudflared tunnel list

# Check DNS
dig parambulator.shsw.dev

# Test tunnel connectivity
cloudflared tunnel run --url localhost:5000
```

### 502 Bad Gateway

Usually means Parambulator isn't running or port mismatch:

```bash
# Verify Parambulator is responding
curl -I http://localhost:5000

# Check if process is running
ps aux | grep parambulator

# Restart Parambulator
./tunnel.sh restart
```

## Maintenance

### Updating cloudflared

```bash
# Download latest version
curl -L --output /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Stop tunnel
./tunnel.sh stop

# Update
sudo dpkg -i /tmp/cloudflared.deb

# Restart
./tunnel.sh start
```

### Rotating Secret Key

```bash
# Generate new key
NEW_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# Update .env or export
export SECRET_KEY="$NEW_KEY"

# Restart
./tunnel.sh restart
```

### Deleting the Tunnel

⚠️ Only if you need to recreate or remove:

```bash
# Stop services
./tunnel.sh stop

# Delete tunnel
cloudflared tunnel delete parambulator

# Remove DNS record (manual via Cloudflare dashboard)
# Remove config files
rm /home/vscode/.cloudflared/config.yml
rm /home/vscode/.cloudflared/4cdefe39-9519-41ac-8d7b-d21d975c3df0.json
```

## Performance

- **Latency**: ~50-100ms additional from Cloudflare routing
- **Bandwidth**: Unlimited via Cloudflare network
- **Uptime**: Depends on local machine uptime
- **Automatic reconnect**: cloudflared handles connection drops

## Next Steps

1. ✅ Monitor logs for first 24 hours
2. Consider adding authentication (see SECURITY_HARDENING_PLAN.md)
3. Set up monitoring/alerting for downtime
4. Switch to Gunicorn for better performance
5. Document any custom configurations
