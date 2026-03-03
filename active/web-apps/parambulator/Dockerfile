FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY parambulator/pyproject.toml /app/pyproject.toml
COPY parambulator/src /app/src
COPY parambulator/templates /app/templates
COPY parambulator/static /app/static
COPY parambulator/data /app/data
COPY shared/src /app/shared/src
COPY shared/templates /app/shared/templates

RUN pip install --no-cache-dir . \
  && mkdir -p /app/data/feedback /app/data/saves \
  && chown -R app:app /app

USER app

EXPOSE 5000

ENV FLASK_DEBUG=false \
    HOST=0.0.0.0 \
    PORT=5000

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "parambulator.app:create_app()"]
