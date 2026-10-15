# Gamebase — production container.
#
# Build from this directory:
#   docker build -t gamebase:local .
# or run scripts/deploy-local.sh, which also starts it against the tunnel.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies from the single source of truth, then copy the runtime
# tree. PYTHONPATH keeps the local package (and its PROJECT_ROOT) authoritative.
COPY pyproject.toml README.md /app/
COPY src /app/src
RUN pip install --no-cache-dir .

COPY templates /app/templates
COPY static /app/static
COPY templates_scaffold /app/templates_scaffold
COPY registry /app/registry
COPY AGENT_GUIDE.md /app/AGENT_GUIDE.md

ENV PYTHONPATH=/app/src \
    GAMEBASE_REGISTRY_DIR=/app/registry \
    GAMEBASE_DB_PATH=/app/instance/gamebase.sqlite3 \
    GAMEBASE_AUTO_RESCAN=1 \
    FLASK_DEBUG=false \
    PORT=5121

EXPOSE 5121

# gevent worker so WebSocket rooms (real-time games) are handled, not blocked.
CMD ["gunicorn", "-k", "gevent", "--worker-connections", "2000", "-w", "1", "--timeout", "180", "-b", "0.0.0.0:5121", "gamebase.app:create_app()"]
