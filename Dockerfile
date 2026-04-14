FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir yfinance flask flask-cors akshare gunicorn

# Copy project
COPY . .

# Expose port
EXPOSE 5177

# Run with gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:5177", "--workers", "2", "--timeout", "300", "--chdir", "app", "server:app"]
