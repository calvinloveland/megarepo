# Security Review - Parambulator (For Internet Hosting)

**Date**: February 7, 2026  
**Status**: Critical vulnerabilities identified - remediation required before production  
**Risk Level**: HIGH

---

## Executive Summary

The Parambulator app is currently configured for **local development only** with `debug=True` and has several security vulnerabilities that must be addressed before hosting on the internet:

1. **Debug mode enabled** - Exposes stack traces, reloader, and debugger
2. **No CSRF protection** - Forms lack CSRF tokens
3. **Path traversal in file operations** - Unsafe filename handling in load/save
4. **No input validation** - Integer inputs not bounded
5. **No authentication/authorization** - Anyone can access/modify all data
6. **No rate limiting** - Vulnerable to DoS/brute force
7. **Insecure default settings** - Missing security headers
8. **Feedback system with user data leakage** - Stores selected element selectors that may contain sensitive info
9. **CDN dependencies** - Tailwind/HTMX loaded from CDN (availability/integrity risk)
10. **No HTTPS enforcement** - Will serve over HTTP in production

---

## Detailed Findings

### 🔴 CRITICAL: Debug Mode Enabled in Production

**Location**: `app.py:main()` - Line 416  
**Severity**: CRITICAL

```python
def main() -> None:
    app = create_app()
    app.run(debug=True)  # ❌ CRITICAL: Debug mode enabled
```

**Risks**:
- Werkzeug debugger exposed on all errors (code execution vector)
- Stack traces expose full application code structure
- File watching and auto-reload in production
- Interactive console available if PIN is guessed/bypassed

**Remediation**:
```python
def main() -> None:
    app = create_app()
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() == "true"
    app.run(debug=debug_mode, host="0.0.0.0", port=5000)
```

---

### 🔴 CRITICAL: No CSRF Protection

**Location**: All POST endpoints (`/generate`, `/design`, `/save`, `/feedback`, `/feedback/mark-addressed`)  
**Severity**: CRITICAL

**Risk**: Cross-site request forgery attacks - attacker can perform actions on behalf of authenticated users.

**Remediation**:
1. Install `Flask-WTF`:
   ```bash
   pip install Flask-WTF
   ```

2. Update app.py:
   ```python
   from flask_wtf.csrf import CSRFProtect
   
   def create_app() -> Flask:
       app = Flask(...)
       app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-key-change-in-production')
       csrf = CSRFProtect(app)
       # ... rest of routes
   ```

3. Add CSRF token to forms in templates:
   ```html
   <form method="POST" action="/generate">
       {{ csrf_token() }}
       <!-- form fields -->
   </form>
   ```

---

### 🔴 CRITICAL: Path Traversal in Load/Save Operations

**Location**: `storage.py:_sanitize_name()` - Line 43  
**Severity**: CRITICAL

Current implementation:
```python
def _sanitize_name(name: str) -> str:
    cleaned = "".join(ch for ch in name if ch.isalnum() or ch in {"-", "_"}).strip()
    return cleaned[:60]
```

**Risk**: Although the function removes special characters, it's used in:
- `/load?name=` endpoint (GET parameter)
- Save name input (user-supplied)

An attacker could potentially craft names that bypass filtering or exploit edge cases.

**Remediation**:
```python
import re
import uuid

def _sanitize_name(name: str) -> str:
    """Sanitize save names to alphanumeric, dash, underscore only."""
    if not name or not isinstance(name, str):
        raise ValueError("Invalid save name")
    
    # Strict whitelist only
    cleaned = re.sub(r'[^a-zA-Z0-9\-_]', '', name).strip()
    
    if not cleaned or len(cleaned) == 0:
        raise ValueError("Save name must contain at least one valid character")
    if len(cleaned) > 60:
        cleaned = cleaned[:60]
    
    return cleaned
```

Additionally, validate paths don't escape the saves directory:
```python
def load_payload(base_dir: Path, name: str) -> Dict[str, object]:
    safe_name = _sanitize_name(name)
    path = storage_dir(base_dir) / f"{safe_name}.json"
    
    # Ensure path is still within storage_dir
    if not path.resolve().is_relative_to(storage_dir(base_dir).resolve()):
        raise ValueError("Invalid save path")
    
    if not path.exists():
        raise FileNotFoundError(f"Save '{safe_name}' not found.")
    return json.loads(path.read_text(encoding="utf-8"))
```

---

### 🔴 CRITICAL: No Input Validation/Bounds

**Location**: `app.py:parse_form()` - Lines 259-263  
**Severity**: CRITICAL

```python
rows = _parse_int(form.get("rows"), DEFAULT_ROWS)
cols = _parse_int(form.get("cols"), DEFAULT_COLS)
iterations = _parse_int(form.get("iterations"), 200)
```

**Risks**:
- No upper bounds on rows/cols - could cause memory exhaustion (DoS)
- No upper bounds on iterations - could cause CPU exhaustion
- Negative values rejected but zero is accepted

**Remediation**:
```python
def _parse_int(value: Optional[str], fallback: int, min_val: int = 1, max_val: int = 100) -> int:
    try:
        parsed = int(value) if value is not None else fallback
    except (ValueError, TypeError):
        return fallback
    
    # Enforce bounds
    if parsed < min_val:
        return min_val
    if parsed > max_val:
        return max_val
    
    return parsed

# Usage:
rows = _parse_int(form.get("rows"), DEFAULT_ROWS, min_val=1, max_val=50)
cols = _parse_int(form.get("cols"), DEFAULT_COLS, min_val=1, max_val=50)
iterations = _parse_int(form.get("iterations"), 200, min_val=1, max_val=500)
```

---

### 🟠 HIGH: No Authentication/Authorization

**Location**: All endpoints  
**Severity**: HIGH

**Risk**: Anyone on the internet can:
- View all saved seating charts
- Modify/delete saved charts
- Submit/manage feedback

**Remediation** (choose based on use case):

**Option A: Simple Password Protection**
```python
from flask import session, redirect
import os

def create_app() -> Flask:
    app = Flask(...)
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')
    
    @app.before_request
    def check_auth():
        if request.path == '/login':
            return
        if 'authenticated' not in session:
            return redirect('/login')
    
    @app.get('/login')
    def login_page():
        return render_template('login.html')
    
    @app.post('/login')
    def login():
        password = request.form.get('password', '')
        if password == os.getenv('APP_PASSWORD'):
            session['authenticated'] = True
            return redirect('/')
        return render_template('login.html', error='Invalid password'), 401
```

**Option B: Simple User Accounts**
```python
from werkzeug.security import generate_password_hash, check_password_hash

# Add user table/file, implement registration/login
```

---

### 🟠 HIGH: No Rate Limiting

**Location**: All POST endpoints  
**Severity**: HIGH

**Risk**: 
- DoS attacks (e.g., rapidly calling `/generate` with large iterations)
- Feedback spam
- Brute force if auth is added

**Remediation**:
```bash
pip install Flask-Limiter
```

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
)

@app.post("/generate")
@limiter.limit("10 per minute")
def generate() -> str:
    # ... endpoint code
```

---

### 🟠 HIGH: Feedback System - User Data Leakage

**Location**: `app.py:submit_feedback()` - Lines 178-198  
**Severity**: HIGH

```python
data["selected_element"] = payload selector
data["page_url"] = request.path
```

**Risk**: The `selected_element` field stores DOM selectors that may contain sensitive information:
- Student names in element IDs
- PII in data attributes
- App structure information

**Remediation**:
```python
@app.post("/feedback")
def submit_feedback() -> Response:
    data = request.get_json()
    if not isinstance(data, dict):
        return Response("Invalid feedback payload", status=400)

    feedback_text = str(data.get("feedback_text", "")).strip()
    if not feedback_text:
        return Response("Feedback text is required", status=400)
    
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    ADDRESSED_DIR.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"feedback_{timestamp}.json"
    filepath = FEEDBACK_DIR / filename
    
    # Only store feedback text, timestamp, and design (if at all)
    # Don't store selected_element or page_url
    feedback_data = {
        "feedback_text": feedback_text,
        "design": data.get("design", "unknown"),  # Optional: which design gave feedback
        "timestamp": data.get("timestamp"),
        "server_timestamp": datetime.now().isoformat(),
        "addressed": False,
    }
    
    with open(filepath, "w") as f:
        json.dump(feedback_data, f, indent=2)
    
    return jsonify({"status": "success", "message": "Feedback saved"})
```

---

### 🟠 HIGH: Missing Security Headers

**Location**: All responses  
**Severity**: HIGH

**Remediation**:
```python
@app.after_request
def set_security_headers(response):
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    
    # Disable MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    # Enable XSS filtering
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Content Security Policy (restrictive)
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.tailwindcss.com https://unpkg.com; "
        "style-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; "
        "img-src 'self'; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'self'"
    )
    
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    
    # Permissions Policy (formerly Feature Policy)
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    
    return response
```

---

### 🟡 MEDIUM: External CDN Dependencies

**Location**: `templates/index.html` - Lines 10-11  
**Severity**: MEDIUM

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
```

**Risks**:
- CDN availability (service interruption)
- Potential for supply-chain attacks if CDN is compromised
- No Subresource Integrity (SRI) validation

**Remediation**:
1. Bundle Tailwind locally via npm:
   ```bash
   npm install -D tailwindcss
   npx tailwindcss -i input.css -o static/style.css
   ```

2. Download HTMX locally or use npm:
   ```bash
   npm install htmx.org
   ```

3. Add SRI hashes if CDN is necessary:
   ```html
   <script src="https://cdn.tailwindcss.com" 
           integrity="sha384-..." 
           crossorigin="anonymous"></script>
   ```

---

### 🟡 MEDIUM: No HTTPS Enforcement

**Location**: Entire application  
**Severity**: MEDIUM

**Risk**: Data in transit is unencrypted; credentials/data exposed via packet sniffing.

**Remediation**:
1. Configure reverse proxy (Nginx/Apache) to enforce HTTPS
2. Add in Flask:
   ```python
   from flask_talisman import Talisman
   
   def create_app() -> Flask:
       app = Flask(...)
       
       if not app.debug:
           Talisman(app, force_https=True)
   ```

3. Set HSTS header:
   ```python
   response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
   ```

---

### 🟡 MEDIUM: No Input Sanitization on JSON Data

**Location**: `app.py:parse_people_json()`, `chart_from_json()`  
**Severity**: MEDIUM

**Risk**: Malformed JSON could cause crashes or unexpected behavior.

**Remediation**:
```python
def parse_people_json(json_str: str) -> List[Person]:
    try:
        data = json.loads(json_str)
        if not isinstance(data, list):
            return default_people()
        
        people = []
        for item in data[:100]:  # Limit to 100 people
            if not isinstance(item, dict):
                continue
            # Validate each field
            person = Person(
                name=str(item.get("name", "Unknown"))[:100],  # Max 100 chars
                reading_level=str(item.get("reading_level", "medium"))[:20],
                talkative=str(item.get("talkative", "no"))[:20],
                iep_front=str(item.get("iep_front", "no"))[:20],
                avoid=str(item.get("avoid", ""))[:500],
            )
            people.append(person)
        return people if people else default_people()
    except (json.JSONDecodeError, ValueError, TypeError):
        return default_people()
```

---

### 🟡 MEDIUM: No Error Handling for File Operations

**Location**: `storage.py:load_payload()`, `app.py:submit_feedback()`  
**Severity**: MEDIUM

**Risk**: Uncaught file system errors expose stack traces and system information.

**Remediation**:
```python
@app.get("/load")
def load() -> str:
    try:
        name = request.args.get("name", "")
        payload = load_payload(PROJECT_ROOT, name)
        # ... rest of function
    except FileNotFoundError:
        return render_template("error.html", message="Save file not found"), 404
    except (json.JSONDecodeError, ValueError) as e:
        return render_template("error.html", message="Invalid save file"), 400
    except Exception as e:
        app.logger.error(f"Unexpected error loading save: {e}")
        return render_template("error.html", message="Server error"), 500
```

---

### 🟡 MEDIUM: No Logging/Monitoring

**Location**: Entire application  
**Severity**: MEDIUM

**Risk**: No visibility into attacks, errors, or user behavior.

**Remediation**:
```python
import logging
from logging.handlers import RotatingFileHandler

def create_app() -> Flask:
    app = Flask(...)
    
    if not app.debug:
        handler = RotatingFileHandler('parambulator.log', maxBytes=10485760, backupCount=10)
        handler.setFormatter(logging.Formatter(
            '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
        ))
        app.logger.addHandler(handler)
        app.logger.setLevel(logging.INFO)
    
    @app.before_request
    def log_request():
        app.logger.info(f"{request.method} {request.path} from {request.remote_addr}")
    
    return app
```

---

### 🟢 LOW: Missing Dependency Version Pinning

**Location**: `pyproject.toml`  
**Severity**: LOW

Current:
```toml
dependencies = [
    "Flask>=2.3",
    "pytest>=7.4",
    ...
]
```

**Risk**: New versions may introduce vulnerabilities or breaking changes.

**Remediation**:
```toml
dependencies = [
    "Flask>=2.3.2,<3.0",
    "Flask-WTF>=1.1.1,<2.0",
    "Flask-Limiter>=3.5.0,<4.0",
    "Flask-Talisman>=1.0.0,<2.0",
]
```

Or use `requirements-lock.txt` with exact versions from `pip freeze`.

---

## Deployment Checklist

- [ ] Disable debug mode (`FLASK_DEBUG=false`)
- [ ] Set `SECRET_KEY` to strong random value from environment
- [ ] Implement CSRF protection (Flask-WTF)
- [ ] Add authentication/authorization
- [ ] Implement rate limiting (Flask-Limiter)
- [ ] Add security headers
- [ ] Validate and bound all inputs
- [ ] Sanitize feedback data (remove PII fields)
- [ ] Bundle CSS/JS locally with SRI
- [ ] Set up HTTPS/TLS
- [ ] Configure logging and monitoring
- [ ] Add error pages (404, 500, etc.)
- [ ] Set up automated security updates
- [ ] Run security scanner (e.g., `bandit`, OWASP ZAP)
- [ ] Load test before production
- [ ] Document security assumptions

---

## Environment Variables Required for Production

```bash
# Required
FLASK_DEBUG=false
SECRET_KEY=$(openssl rand -hex 32)
APP_PASSWORD=<strong-password>

# Recommended
FLASK_ENV=production
LOG_LEVEL=INFO
WORKERS=4
```

---

## Running Secure Development Server

```bash
export FLASK_DEBUG=false
export SECRET_KEY=dev-key-change-in-production
python -m parambulator.app
```

---

## Production Deployment (Gunicorn + Nginx)

```bash
# Install Gunicorn
pip install gunicorn

# Run with multiple workers
gunicorn -w 4 -b 127.0.0.1:5000 'parambulator.app:create_app()'
```

Nginx config (reverse proxy):
```nginx
server {
    listen 443 ssl http2;
    server_name parambulator.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Enforce TLS 1.2+
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name parambulator.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Security Testing Tools

- **Bandit** (Python security linter):
  ```bash
  pip install bandit
  bandit -r src/parambulator/
  ```

- **OWASP ZAP** (Dynamic security testing)
- **Snyk** (Dependency vulnerability scanning)
- **SQLAlchemy** (if using database in future)

---

## Summary of Priority Actions

| Priority | Issue | Timeline |
|----------|-------|----------|
| P0 | Disable debug mode | Before any internet exposure |
| P0 | Implement CSRF protection | Before P0 |
| P0 | Add authentication | Before any data is exposed |
| P1 | Path traversal fixes | Within 1 week |
| P1 | Input validation bounds | Within 1 week |
| P1 | Rate limiting | Within 2 weeks |
| P2 | Security headers | Within 2 weeks |
| P2 | Feedback data sanitization | Before launch |
| P3 | HTTPS enforcement | Before production |
| P3 | Logging/monitoring | Before launch |

---

## Questions for Product Owner

1. **Who should have access?** (Public, private organization, specific users?)
2. **What data is sensitive?** (Student names, constraints?)
3. **Data retention policy?** (How long to keep feedback/saves?)
4. **Compliance requirements?** (FERPA, GDPR, etc.?)
5. **Expected user volume?** (For capacity planning)
6. **Deployment target?** (Heroku, AWS, own server, container?)

