# Parambulator

A Flask + HTMX web application for building seating charts with constraint-based scoring. Designed for educators to optimize classroom layouts using reading levels, behavior considerations, IEP requirements, and social dynamics.

## Features

- **Smart Seating Generation**: Iterative algorithm scores arrangements based on configurable constraints
- **Flexible Constraints**: Mix reading levels, separate talkative students, prioritize IEP front-row seating, enforce explicit avoidance pairs
- **Multiple Input Formats**: JSON or table-based people input
- **Custom Layouts**: Define available seats with visual grid editor
- **Save/Load System**: Persistent server-side storage for seating plans
- **Five UI Designs**: Compare different interface layouts
- **User Feedback**: Built-in feedback system for collecting user suggestions

## Architecture

### Stack
- **Backend**: Flask 2.3+ with Flask-WTF (CSRF protection)
- **Frontend**: HTMX for interactivity, Tailwind CSS for styling
- **Server**: Gunicorn for production (configured in Dockerfile)
- **Testing**: pytest + Playwright for E2E tests (~1300 LOC total)

### Project Structure
```
parambulator/
├── src/parambulator/
│   ├── app.py          # Flask app, routes, request handling (501 lines)
│   ├── models.py       # Person, Chart data models (173 lines)
│   ├── scoring.py      # Constraint scoring algorithms (274 lines)
│   └── storage.py      # File I/O for saves/feedback (50 lines)
├── templates/          # 14 Jinja2 templates + partials
├── static/             # CSS assets
├── tests/              # 10 tests (3 units, 3 feedback, 4 E2E)
└── data/
    ├── saves/          # User-generated seating plans
    └── feedback/       # User feedback submissions
```

## Quickstart (Development)

```bash
cd active/web-apps/parambulator
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Development mode (debug enabled)
export FLASK_DEBUG=true
python -m parambulator.app
```

Open http://127.0.0.1:5000

## Production Deployment

### Using Docker Compose (Recommended)

```bash
# Generate secure secret key
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# Start container
docker-compose up -d

# View logs
docker-compose logs -f
```

### Using Gunicorn Directly

```bash
# Install dependencies
pip install -e .

# Set environment variables
export SECRET_KEY="your-secure-key-here"
export FLASK_DEBUG=false
export PORT=5000
export MAX_CONTENT_LENGTH=1048576  # 1MB limit

# Run with Gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 "parambulator.app:create_app()"
```

## Security Status

**Current State**: ✅ **Phase 1 Complete** - Critical security fixes implemented

The application has undergone comprehensive security hardening:

### ✅ Implemented (Phase 1)
- CSRF protection on all forms (Flask-WTF)
- Debug mode configurable via environment variable
- Input validation and bounds checking
- Path traversal prevention in save/load
- Secure session cookie configuration
- PII protection in feedback system

### 📋 Recommended for Public Internet (Phase 2)
See [SECURITY_HARDENING_PLAN.md](SECURITY_HARDENING_PLAN.md) for:
- Authentication system (Weeks 3-4)
- Rate limiting (Week 5)
- Security headers (Week 5)
- Logging and monitoring (Week 6)

### 📄 Security Documentation
- **[SECURITY_SUMMARY.md](SECURITY_SUMMARY.md)** - Executive overview, risk assessment, deployment readiness
- **[SECURITY_REVIEW.md](SECURITY_REVIEW.md)** - Detailed vulnerability analysis (675 lines)
- **[SECURITY_HARDENING_PLAN.md](SECURITY_HARDENING_PLAN.md)** - Week-by-week implementation roadmap
- **[SECURITY_QUICK_FIX.md](SECURITY_QUICK_FIX.md)** - Copy-paste code fixes

**Deployment Recommendation**:
- ✅ Safe for internal/protected networks (VPN, intranet)
- ⚠️  Add authentication before public internet deployment
- ✅ Docker setup includes non-root user, health checks, volume persistence

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | _(required)_ | Flask session secret (use `secrets.token_hex(32)`) |
| `FLASK_DEBUG` | `false` | Enable debug mode (dev only) |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for containers) |
| `PORT` | `5000` | HTTP port |
| `MAX_CONTENT_LENGTH` | `1048576` | Max request size in bytes (1MB) |
| `LOG_FILE` | _(optional)_ | Log file path (stdout if unset) |

## Testing

```bash
# Unit tests (fast)
pytest tests/test_scoring.py tests/test_feedback.py

# E2E tests (requires Playwright browsers)
export PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright_browsers
npx playwright install --with-deps chromium
pytest tests/test_ui_playwright.py

# Feedback improvement tests (comprehensive E2E suite)
./run_feedback_tests.sh

# All tests
FLASK_DEBUG=true pytest -v
```

### Test Suites

- **test_scoring.py** - Unit tests for seating algorithm
- **test_feedback.py** - Feedback system unit tests  
- **test_ui_playwright.py** - Basic UI integration tests
- **test_feedback_improvements.py** - Comprehensive tests for all feedback-driven improvements:
  - Feedback element selector fixes
  - Version tracking in submissions
  - Button-based grid layout editor
  - Column configuration UI
  - Design-4 contrast
  - Header row parsing
  - Integration scenarios

**Note**: Tests require `FLASK_DEBUG=true` or `SECRET_KEY` environment variable.

## Usage

1. **Input People**: Enter student data via JSON or table format
2. **Configure Constraints**: Adjust weights for different seating priorities
3. **Define Layout**: Mark available/unavailable seats in the grid
4. **Generate**: Algorithm runs 150 iterations to find optimal arrangement
5. **Review Scores**: See breakdown of constraint satisfaction
6. **Save/Load**: Persist charts for later reference

### Constraint Types

- **Reading Level Mix** (default 35%): Distributes high/medium/low readers evenly
- **Talkative Separation** (default 25%): Spaces out chatty students
- **IEP Front Row** (default 25%): Prioritizes special needs students for front seats
- **Explicit Avoidance** (default 15%): Prevents specific student pairings

## Data Storage

- **Saves**: `data/saves/*.json` - User-created seating charts (not committed)
- **Feedback**: `data/feedback/*.json` - User submissions (not committed)
- **Feedback Addressed**: `data/feedback/addressed/*.json` - Archived feedback

All `.json` files are gitignored. Docker volumes persist across container restarts.

## Known Limitations

- No multi-user support (single-tenant app)
- No authentication (suitable for trusted environments)
- Limited to rectangular grids (custom shapes via layout editor)
- Scoring is heuristic-based (not guaranteed optimal)

## Contributing

Run tests before committing:
```bash
FLASK_DEBUG=true pytest -v
```

Ensure all security configurations remain intact when modifying `app.py`.

## License

MIT License (see LICENSE file if present)
