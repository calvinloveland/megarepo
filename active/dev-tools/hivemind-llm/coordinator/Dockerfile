FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.lock pyproject.toml .
RUN pip install --require-hashes --no-deps -r requirements.lock && \
    pip install --no-cache-dir --no-deps . && \
    rm -rf /root/.cache

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 5000

CMD ["python", "app.py"]
