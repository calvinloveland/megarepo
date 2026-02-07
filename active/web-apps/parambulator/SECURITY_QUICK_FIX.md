# Quick Start: Security Fixes for Production

This file contains ready-to-use code snippets to address the 10 critical security vulnerabilities identified in `SECURITY_REVIEW.md`.

---

## 1️⃣ Disable Debug Mode

**File**: `src/parambulator/app.py`

```python
import os

def main() -> None:
    app = create_app()
    debug = os.getenv("FLASK_DEBUG", "").lower() == "true"
    port = int(os.getenv("PORT", 5000))
    host = os.getenv("HOST", "127.0.0.1")
    
    app.run(debug=debug, host=host, port=port)

if __name__ == "__main__":
    main()
```

**Usage**:
```bash
export FLASK_DEBUG=false  # Production
python -m parambulator.app
```

---

## 2️⃣ Add CSRF Protection

### Step 1: Update pyproject.toml

```toml
dependencies = [
    "Flask>=2.3.2,<3.0",
    "Flask-WTF>=1.1.1,<2.0",
    # ... rest
]
```

### Step 2: Update app.py

```python
from flask_wtf.csrf import CSRFProtect
import os

def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )
    
    # Configure session security
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-key-change-in-production')
    if not app.debug:
        app.config['SESSION_COOKIE_SECURE'] = True
        app.config['SESSION_COOKIE_HTTPONLY'] = True
        app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    
    # Enable CSRF protection
    csrf = CSRFProtect(app)
    
    # ... rest of routes
```

### Step 3: Add CSRF token to all forms

In **any template with a form**, add this after opening `<form>` tag:

```html
<form method="POST" action="/generate">
    {{ csrf_token() }}
    <!-- form fields -->
</form>
```

### Step 4: Disable CSRF for JSON endpoints (optional)

If you have API endpoints that use JSON:

```python
@app.post("/api/feedback")
@csrf.exempt  # Only for trusted internal APIs
def api_feedback():
    # ... handle JSON
```

**Test**: Submit form, check for CSRF error if token missing

---

## 3️⃣ Add Input Validation Bounds

**File**: `src/parambulator/app.py`

Replace the existing `_parse_int()` function:

```python
def _parse_int(value: Optional[str], fallback: int, min_val: int = 1, max_val: int = 1000) -> int:
    """Parse and validate integer with bounds."""
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

Update `parse_form()`:

```python
def parse_form(form: Dict[str, str]) -> Dict[str, object]:
    people_table = form.get("people_table", "").strip()
    people_json = form.get("people_json", "").strip()
    
    # ... existing code ...
    
    # UPDATED: Add bounds to numeric inputs
    rows = _parse_int(form.get("rows"), DEFAULT_ROWS, min_val=1, max_val=50)
    cols = _parse_int(form.get("cols"), DEFAULT_COLS, min_val=1, max_val=50)
    iterations = _parse_int(form.get("iterations"), 200, min_val=1, max_val=500)
    
    # ... rest of function
```

**Test**: Try submitting `rows=10000`, verify it's capped at 50

---

## 4️⃣ Fix Path Traversal Issues

**File**: `src/parambulator/storage.py`

```python
import re
from pathlib import Path

def _sanitize_name(name: str) -> str:
    """
    Strict whitelist: only alphanumeric, dash, underscore.
    
    Args:
        name: User-provided save name
    
    Returns:
        Sanitized name (max 60 chars)
    
    Raises:
        ValueError: If name is invalid
    """
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
    """Load payload with path traversal protection."""
    safe_name = _sanitize_name(name)
    path = storage_dir(base_dir) / f"{safe_name}.json"
    
    # Verify path is still within saves directory
    try:
        path.resolve().relative_to(storage_dir(base_dir).resolve())
    except ValueError:
        raise ValueError("Invalid save path (path traversal detected)")
    
    if not path.exists():
        raise FileNotFoundError(f"Save '{safe_name}' not found.")
    
    return json.loads(path.read_text(encoding="utf-8"))
```

**Test**: Try accessing `/load?name=../../../etc/passwd`, verify error

---

## 5️⃣ Remove PII from Feedback

**File**: `src/parambulator/app.py`

```python
@app.post("/feedback")
def submit_feedback() -> Response:
    """Handle feedback submissions safely."""
    data = request.get_json()
    if not isinstance(data, dict):
        return Response("Invalid feedback payload", status=400)

    feedback_text = str(data.get("feedback_text", "")).strip()
    
    # Validate feedback
    if not feedback_text:
        return Response("Feedback text is required", status=400)
    if len(feedback_text) > 5000:
        return Response("Feedback text must be < 5000 characters", status=400)
    
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    ADDRESSED_DIR.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    
    # IMPORTANT: Only store feedback text and timestamp
    # Don't store: selected_element, page_url (contains PII)
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

**Test**: Submit feedback, verify JSON doesn't contain `selected_element`

---

## 6️⃣ Add Security Headers

**File**: `src/parambulator/app.py`

Add this after the route definitions, before returning `app`:

```python
@app.after_request
def set_security_headers(response):
    """Add security headers to all responses."""
    
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    # Enable XSS filter (legacy, but still useful)
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Content Security Policy
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.tailwindcss.com https://unpkg.com; "
        "style-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "frame-ancestors 'self'; "
        "base-uri 'self'"
    )
    
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    
    # Permissions Policy (disable unnecessary features)
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    
    return response
```

**Test**: Check headers in browser DevTools (F12 → Network → Response Headers)

---

## 7️⃣ Add Error Handling & Logging

**File**: `src/parambulator/app.py`

Add at the top:

```python
import logging
from logging.handlers import RotatingFileHandler
import os
```

Add in `create_app()` before returning app:

```python
# Configure logging
if not app.debug:
    log_file = os.getenv('LOG_FILE', 'parambulator.log')
    handler = RotatingFileHandler(
        log_file,
        maxBytes=10485760,  # 10MB
        backupCount=10
    )
    handler.setFormatter(logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    ))
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)

# Error handlers
@app.errorhandler(404)
def not_found(error):
    app.logger.warning(f"404 from {request.remote_addr}: {request.path}")
    return render_template("error.html", status=404, message="Page not found"), 404

@app.errorhandler(500)
def server_error(error):
    app.logger.error(f"500 error from {request.remote_addr}: {error}")
    return render_template("error.html", status=500, message="Server error"), 500

@app.errorhandler(ValueError)
def handle_value_error(err):
    app.logger.warning(f"Validation error: {err}")
    return Response(str(err), status=400)

@app.errorhandler(FileNotFoundError)
def handle_file_not_found(err):
    app.logger.warning(f"File not found: {err}")
    return Response(str(err), status=404)
```

Create **`templates/error.html`**:

```html
<!doctype html>
<html>
<head>
    <title>Error {{ status }}</title>
    <style>
        body { font-family: sans-serif; margin: 40px; }
        h1 { color: #d32f2f; }
    </style>
</head>
<body>
    <h1>Error {{ status }}</h1>
    <p>{{ message }}</p>
    <p><a href="/">← Back to home</a></p>
</body>
</html>
```

**Test**: Access `/nonexistent`, verify generic error page

---

## 8️⃣ Add Rate Limiting (Optional but Recommended)

### Step 1: Add dependency

```toml
# pyproject.toml
dependencies = [
    "Flask-Limiter>=3.5.0,<4.0",
    # ... rest
]
```

### Step 2: Update app.py

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

def create_app() -> Flask:
    app = Flask(...)
    
    # Rate limiting
    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://",  # Use Redis in production
    )
    
    @app.get("/")
    @limiter.limit("100 per hour")
    def index() -> str:
        # ... existing code
    
    @app.post("/generate")
    @limiter.limit("10 per minute")  # Expensive operation
    def generate() -> str:
        # ... existing code
    
    @app.post("/feedback")
    @limiter.limit("5 per hour")
    def submit_feedback() -> Response:
        # ... existing code
```

**Test**: Hit `/generate` 11 times in 1 minute, verify `429 Too Many Requests`

---

## 9️⃣ Set SECRET_KEY from Environment

**File**: `src/parambulator/app.py`

```python
import os

def create_app() -> Flask:
    app = Flask(...)
    
    # Get SECRET_KEY from environment (required for production)
    secret_key = os.getenv('SECRET_KEY')
    if not secret_key and not app.debug:
        raise ValueError("SECRET_KEY environment variable is required in production")
    
    app.config['SECRET_KEY'] = secret_key or 'dev-key-not-for-production'
    
    # ... rest of app initialization
```

**Usage**:
```bash
# Generate a strong secret key
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
python -m parambulator.app
```

---

## 🔟 Minimal Production Configuration

Create **`.env.example`** in project root:

```bash
# Required
FLASK_DEBUG=false
SECRET_KEY=<generate-with-python-secrets>
APP_PASSWORD=<strong-password>

# Optional
PORT=5000
HOST=0.0.0.0
LOG_FILE=parambulator.log
LOG_LEVEL=INFO
```

Create **`run_production.sh`**:

```bash
#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Verify required variables
if [ -z "$SECRET_KEY" ]; then
    echo "ERROR: SECRET_KEY not set"
    exit 1
fi

if [ -z "$APP_PASSWORD" ]; then
    echo "ERROR: APP_PASSWORD not set"
    exit 1
fi

# Run with production settings
export FLASK_DEBUG=false
gunicorn -w 4 -b 0.0.0.0:${PORT:-5000} 'parambulator.app:create_app()'
```

Usage:
```bash
chmod +x run_production.sh
./run_production.sh
```

---

## Implementation Checklist

- [ ] Install dependencies: `pip install Flask-WTF Flask-Limiter`
- [ ] Update `app.py` with all code snippets above
- [ ] Update `storage.py` with sanitization fixes
- [ ] Add CSRF token to all form templates
- [ ] Create `templates/error.html`
- [ ] Test CSRF protection
- [ ] Test input validation bounds
- [ ] Test path traversal protection
- [ ] Test error pages
- [ ] Test rate limiting
- [ ] Generate SECRET_KEY: `python -c "import secrets; print(secrets.token_hex(32))"`
- [ ] Test with FLASK_DEBUG=false
- [ ] Run tests: `pytest tests/ -v`
- [ ] Check logs are being written
- [ ] Verify no secrets in code
- [ ] Review .gitignore

---

## Quick Testing

```bash
# 1. Install dependencies
pip install -e .

# 2. Set environment variables
export FLASK_DEBUG=false
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
export APP_PASSWORD=test123

# 3. Run app
python -m parambulator.app

# 4. Test CSRF
curl -X POST http://localhost:5000/generate \
  -d "rows=10" \
  # Should fail with CSRF error

# 5. Test input bounds
curl -X POST http://localhost:5000/generate \
  -d "rows=10000&cols=10000" \
  # Should cap at 50x50

# 6. Test rate limiting
for i in {1..15}; do
  curl http://localhost:5000/generate -X POST
done
# Should see 429 after 10 requests

# 7. Check headers
curl -I http://localhost:5000/
# Should see X-Frame-Options, Content-Security-Policy, etc.

# 8. Test error handling
curl http://localhost:5000/nonexistent
# Should show generic error page
```

---

## Next Steps

1. ✅ Implement all 10 fixes above
2. ✅ Test thoroughly in development
3. ✅ Deploy to staging environment
4. ✅ Run security scanner: `bandit -r src/`
5. ✅ Load test with `locust`
6. ✅ Set up monitoring/logging
7. ✅ Deploy to production with HTTPS
8. ✅ Monitor logs for errors/attacks

---

