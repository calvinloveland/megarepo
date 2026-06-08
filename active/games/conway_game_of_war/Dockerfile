FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system --gid 1001 app \
  && adduser --system --uid 1001 --ingroup app app

# Copy the entire package so Flask can find templates/static relative to the module
COPY pyproject.toml /app/
COPY src /app/src

RUN pip install --no-cache-dir /app && rm -rf /root/.cache

USER app

EXPOSE 5000

ENV FLASK_DEBUG=false \
    HOST=0.0.0.0 \
    PORT=5000

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "conways_game_of_war.main:app"]
