FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 5000

CMD ["python", "app.py"]
