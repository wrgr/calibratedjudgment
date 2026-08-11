FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/ backend/
COPY content/ content/
COPY docs/ docs/
RUN pip install --no-cache-dir -e "backend[llm]"
COPY --from=web /app/frontend/dist frontend/dist
EXPOSE 8000
WORKDIR /app/backend
# --proxy-headers + --forwarded-allow-ips: honor X-Forwarded-Proto from the
# reverse proxy so session cookies get the Secure flag behind TLS.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
