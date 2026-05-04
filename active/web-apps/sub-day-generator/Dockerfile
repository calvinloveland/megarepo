FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system --gid 1001 app \
  && adduser --system --uid 1001 --ingroup app app

COPY sub-day-generator/pyproject.toml /app/pyproject.toml
COPY sub-day-generator/requirements.lock /app/requirements.lock
COPY sub-day-generator/src /app/src
COPY sub-day-generator/templates /app/templates
COPY shared/src /app/shared/src
COPY shared/templates /app/shared/templates

RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock \
  && pip install --no-cache-dir --no-deps /app

USER app

EXPOSE 5000

ENV FLASK_DEBUG=false \
    HOST=0.0.0.0 \
    PORT=5000

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "sub_day_generator.app:create_app()"]
