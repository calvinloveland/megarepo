# Security Hardening Plan - Parambulator

**Purpose**: Systematic remediation of security vulnerabilities for internet hosting  
**Status**: Ready for implementation  
**Target**: Production-ready security posture

---

## Phase 1: Critical Fixes (Blocking Production) 🔴

### 1.1 Disable Debug Mode

**File**: `src/parambulator/app.py`  
**Effort**: 5 minutes

```python
# Before (line 415)
def main() -> None:
    app = create_app()
    app.run(debug=True)

# After
import os

def main() -> None:
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    port = int(os.getenv("PORT", 5000))
    app.run(debug=debug, host="0.0.0.0", port=port)
```

**Testing**: Verify error page doesn't show debugger

---

### 1.2 Add CSRF Protection

**File**: `src/parambulator/app.py`, `templates/**/*.html`  
**Effort**: 30 minutes  
**Dependencies**: `Flask-WTF`

**Steps**:
1. Add to pyproject.toml: `"Flask-WTF>=1.1.1,<2.0"`
2. Update `create_app()`:
   ```python
   from flask_wtf.csrf import CSRFProtect
   
   def create_app() -> Flask:
       app = Flask(...)
       app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-key-change-in-production')
       if not app.debug:
           app.config['SESSION_COOKIE_SECURE'] = True
           app.config['SESSION_COOKIE_HTTPONLY'] = True
           app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
       csrf = CSRFProtect(app)
       # ... routes
   ```

3. Add CSRF token to all forms (use Jinja filter)
4. Test CSRF protection with malicious requests

---

### 1.3 Add Input Validation Bounds

**File**: `src/parambulator/app.py`  
**Effort**: 15 minutes

Update `parse_form()`:
```python
rows = _parse_int(form.get("rows"), DEFAULT_ROWS, min_val=1, max_val=50)
cols = _parse_int(form.get("cols"), DEFAULT_COLS, min_val=1, max_val=50)
iterations = _parse_int(form.get("iterations"), 200, min_val=1, max_val=500)
```

Add validation function:
```python
def _parse_int(value: Optional[str], fallback: int, min_val: int = 1, max_val: int = 1000) -> int:
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
```

**Testing**: Try to submit rows=10000, verify capped at 50

---

### 1.4 Improve Path Traversal Protection

**File**: `src/parambulator/storage.py`  
**Effort**: 20 minutes

Enhance `_sanitize_name()`:
```python
import re
from pathlib import Path

def _sanitize_name(name: str) -> str:
    """Strict whitelist: alphanumeric, dash, underscore only."""
    if not name or not isinstance(name, str):
        raise ValueError("Invalid save name")
    
    # Remove any character not in whitelist
    cleaned = re.sub(r'[^a-zA-Z0-9\-_]', '', name).strip()
    
    if not cleaned:
        raise ValueError("Save name must contain at least one valid character")
    
    if len(cleaned) > 60:
        cleaned = cleaned[:60]
    
    return cleaned

def load_payload(base_dir: Path, name: str) -> Dict[str, object]:
    safe_name = _sanitize_name(name)
    path = storage_dir(base_dir) / f"{safe_name}.json"
    
    # Verify path is still within saves directory
    try:
        path.resolve().relative_to(storage_dir(base_dir).resolve())
    except ValueError:
        raise ValueError("Invalid save path")
    
    if not path.exists():
        raise FileNotFoundError(f"Save '{safe_name}' not found.")
    
    return json.loads(path.read_text(encoding="utf-8"))
```

**Testing**: Try load?name=../../../etc/passwd, verify blocked

---

### 1.5 Remove PII from Feedback

**File**: `src/parambulator/app.py` (submit_feedback function)  
**Effort**: 10 minutes

```python
@app.post("/feedback")
def submit_feedback() -> Response:
    data = request.get_json()
    if not isinstance(data, dict):
        return Response("Invalid feedback payload", status=400)

    feedback_text = str(data.get("feedback_text", "")).strip()
    if not feedback_text or len(feedback_text) > 5000:
        return Response("Feedback text is required and must be < 5000 chars", status=400)
    
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    ADDRESSED_DIR.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    
    # Only store feedback text, timestamp, and design
    # Don't store: selected_element, page_url (PII)
    feedback_data = {
        "feedback_text": feedback_text,
        "design": data.get("design", "unknown"),
        "timestamp": data.get("timestamp"),
        "server_timestamp": datetime.now().isoformat(),
        "addressed": False,
    }
    
    filepath = FEEDBACK_DIR / f"feedback_{timestamp}.json"
    with open(filepath, "w") as f:
        json.dump(feedback_data, f, indent=2)
    
    return jsonify({"status": "success", "message": "Feedback saved", "id": timestamp})
```

**Testing**: Submit feedback, verify selected_element not in file

---

## Phase 2: High Priority Fixes (2-3 weeks) 🟠

### 2.1 Add Authentication

**File**: New file `src/parambulator/auth.py` + updates to `app.py`  
**Effort**: 2-3 hours  
**Dependencies**: Consider use case

**Simple option**: Password-based
```python
from functools import wraps
from flask import session, redirect, request

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.path.startswith('/static'):
            return f(*args, **kwargs)
        if 'authenticated' not in session:
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated_function

@app.get('/login')
def login_page():
    return render_template('login.html')

@app.post('/login')
def login():
    password = request.form.get('password', '')
    if password == os.getenv('APP_PASSWORD', 'change-me'):
        session['authenticated'] = True
        return redirect('/')
    return render_template('login.html', error='Invalid password'), 401

@app.get('/logout')
def logout():
    session.clear()
    return redirect('/login')
```

**Testing**: Verify unauthenticated users redirected to login

---

### 2.2 Add Rate Limiting

**File**: `src/parambulator/app.py`  
**Effort**: 30 minutes  
**Dependencies**: `Flask-Limiter`

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

def create_app() -> Flask:
    app = Flask(...)
    
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",  # Use Redis in production
    )
    
    # Apply to expensive endpoints
    @app.post("/generate")
    @limiter.limit("10 per minute")
    def generate() -> str:
        # ... existing code
```

**Testing**: Hit endpoint 11 times in 1 minute, verify 429 response

---

### 2.3 Add Security Headers

**File**: `src/parambulator/app.py`  
**Effort**: 20 minutes

```python
@app.after_request
def set_security_headers(response):
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    # Enable XSS filter
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Content Security Policy
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.tailwindcss.com https://unpkg.com; "
        "style-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'self'"
    )
    
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    
    return response
```

**Testing**: Check headers in browser DevTools

---

### 2.4 Add Error Handling & Logging

**File**: `src/parambulator/app.py`  
**Effort**: 1 hour

```python
import logging
from logging.handlers import RotatingFileHandler

def create_app() -> Flask:
    app = Flask(...)
    
    # Configure logging
    if not app.debug:
        log_handler = RotatingFileHandler(
            'parambulator.log',
            maxBytes=10485760,  # 10MB
            backupCount=10
        )
        log_handler.setFormatter(logging.Formatter(
            '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
        ))
        app.logger.addHandler(log_handler)
        app.logger.setLevel(logging.INFO)
    
    # Error handlers
    @app.errorhandler(404)
    def not_found(error):
        return render_template('error.html', status=404, message='Not found'), 404
    
    @app.errorhandler(500)
    def server_error(error):
        app.logger.error(f"Server error: {error}")
        return render_template('error.html', status=500, message='Server error'), 500
    
    @app.errorhandler(ValueError)
    def handle_value_error(error):
        app.logger.warning(f"Validation error: {error}")
        return Response(str(error), status=400)
    
    return app
```

**Create**: `templates/error.html` with generic error page

---

### 2.5 Input Sanitization for JSON

**File**: `src/parambulator/models.py`  
**Effort**: 45 minutes

Add validation to all JSON parsing functions:
```python
def parse_people_json(json_str: str) -> List[Person]:
    try:
        data = json.loads(json_str)
        if not isinstance(data, list):
            return default_people()
        
        people = []
        for idx, item in enumerate(data[:100]):  # Max 100 people
            if not isinstance(item, dict):
                continue
            
            # Validate each field
            person = Person(
                name=_validate_str(item.get("name", "Unknown"), max_len=100),
                reading_level=_validate_choice(item.get("reading_level", "medium"), ["low", "medium", "high"]),
                talkative=_validate_choice(item.get("talkative", "no"), ["yes", "no"]),
                iep_front=_validate_choice(item.get("iep_front", "no"), ["yes", "no"]),
                avoid=_validate_str(item.get("avoid", ""), max_len=500),
            )
            people.append(person)
        
        return people if people else default_people()
    
    except (json.JSONDecodeError, ValueError, TypeError):
        return default_people()

def _validate_str(value: any, max_len: int = 1000) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]

def _validate_choice(value: any, choices: List[str]) -> str:
    if isinstance(value, str) and value in choices:
        return value
    return choices[0]  # Default
```

**Testing**: Submit invalid JSON, verify defaults applied

---

## Phase 3: Medium Priority (3-4 weeks) 🟡

### 3.1 Bundle CSS/JS Locally

**Effort**: 1.5 hours

```bash
# Install npm dependencies
npm init -y
npm install -D tailwindcss
npm install htmx.org

# Generate CSS
npx tailwindcss -i src/input.css -o static/style.css
```

Update `templates/index.html`:
```html
<link rel="stylesheet" href="/static/style.css" />
<script src="/static/htmx.min.js"></script>
```

**Benefits**: Eliminates CDN dependency, better control

---

### 3.2 HTTPS Enforcement

**Effort**: Depends on deployment target

For Heroku/cloud:
```python
@app.before_request
def enforce_https():
    if not app.debug and request.headers.get('X-Forwarded-Proto', 'http') != 'https':
        return redirect(request.url.replace('http://', 'https://', 1), code=301)
```

For self-hosted (Nginx reverse proxy already required):
```nginx
server {
    listen 443 ssl http2;
    server_name example.com;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

---

### 3.3 Dependency Version Pinning

**File**: `pyproject.toml`  
**Effort**: 15 minutes

Create `requirements-lock.txt` with exact versions:
```
Flask==2.3.2
Werkzeug==2.3.6
Flask-WTF==1.1.1
Flask-Limiter==3.5.0
...
```

Or update pyproject.toml with range constraints:
```toml
dependencies = [
    "Flask>=2.3.2,<3.0",
    "Flask-WTF>=1.1.1,<2.0",
    "Flask-Limiter>=3.5.0,<4.0",
]
```

**Testing**: Run `pip install --dry-run` to verify no conflicts

---

## Phase 4: Additional Hardening (Optional) 🟢

- [ ] Add request ID tracking for debugging
- [ ] Implement session timeout (30 min inactivity)
- [ ] Add email notifications for feedback/saves
- [ ] Set up automated backups of save data
- [ ] Add database (SQLite/PostgreSQL) for saves instead of files
- [ ] Implement audit logging
- [ ] Add TOTP 2FA for admin access
- [ ] Set up monitoring/alerting (Sentry, DataDog)
- [ ] Load testing with k6/Apache JMeter
- [ ] Pentesting by security professional

---

## Implementation Order

**Week 1** (Critical):
1. Disable debug mode
2. Add CSRF protection
3. Input validation bounds
4. Path traversal fixes
5. Remove PII from feedback
6. Test thoroughly

**Week 2** (High Priority):
1. Add authentication
2. Rate limiting
3. Security headers
4. Error handling/logging

**Week 3-4** (Medium):
1. Bundle CSS/JS locally
2. HTTPS enforcement
3. Dependency pinning
4. Security testing

---

## Testing Strategy

### Unit Tests
```bash
pytest tests/ -v --cov
```

### Security Scanning
```bash
# Python security linter
pip install bandit
bandit -r src/

# Dependency check
pip install safety
safety check
```

### Manual Testing Checklist
- [ ] CSRF token on all forms
- [ ] Cannot bypass auth
- [ ] Rate limiting blocks excess requests
- [ ] Error pages don't leak info
- [ ] Logs capture security events
- [ ] Feedbacks don't contain PII
- [ ] Path traversal blocked
- [ ] Input bounds enforced

### Load Testing
```bash
pip install locust

# Run locustfile.py with realistic load
locust -f locustfile.py --headless -u 100 -r 10 -t 5m
```

---

## Deployment Readiness Checklist

- [ ] All Phase 1 + Phase 2 issues fixed and tested
- [ ] Security headers verified in DevTools
- [ ] CSRF token working on all forms
- [ ] Authentication required to access app
- [ ] Rate limiting configured
- [ ] Logging to file (not stdout)
- [ ] No debug mode enabled
- [ ] SECRET_KEY set from environment
- [ ] All tests passing (unit + security)
- [ ] No hardcoded secrets in code
- [ ] .gitignore excludes sensitive files
- [ ] Error pages don't expose stack traces
- [ ] HTTPS configured (if self-hosted)
- [ ] Backup/restore process documented
- [ ] Monitoring/alerting configured

---

## Questions Before Deployment

1. **Expected user base?** (Determines auth complexity)
2. **Data retention policy?** (How long to keep saves/feedback?)
3. **Compliance?** (FERPA, GDPR, HIPAA?)
4. **Deployment target?** (Heroku, AWS, own server?)
5. **Budget for hosting/tools?** (Sentry, monitoring, etc.)
6. **Backup requirements?** (Daily? Offsite?)
7. **Support contact?** (For security issues)

---

