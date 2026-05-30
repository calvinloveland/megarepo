FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system --gid 1001 app \
  && adduser --system --uid 1001 --ingroup app app

COPY pyproject.toml /app/
RUN pip install --no-cache-dir /app && rm -rf /root/.cache

COPY src /app/src

USER app

EXPOSE 5055

ENV FLASK_DEBUG=false \
    WIZARD_FIGHT_HOST=0.0.0.0 \
    WIZARD_FIGHT_PORT=5055

CMD ["python", "-m", "wizard_fight.server"]
