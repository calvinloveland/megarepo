FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system --gid 1001 app \
  && adduser --system --uid 1001 --ingroup app app

COPY games/code_reviewdle/pyproject.toml /app/pyproject.toml
COPY games/code_reviewdle/src /app/src
COPY games/code_reviewdle/templates /app/templates
COPY games/code_reviewdle/static /app/static
COPY games/code_reviewdle/data /app/data
COPY web-apps/shared/src /app/shared/src
COPY web-apps/shared/templates /app/shared/templates

RUN pip install --no-cache-dir /app

USER app

EXPOSE 5000

ENV FLASK_DEBUG=false \
    HOST=0.0.0.0 \
    PORT=5000

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "code_reviewdle.app:create_app()"]
