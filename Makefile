PY ?= python3
VENV = backend/.venv
PIP = $(VENV)/bin/pip
PYTHON = $(VENV)/bin/python

.PHONY: setup backend-setup frontend-setup dev api web seed test e2e build gen-api

setup: backend-setup frontend-setup

backend-setup:
	$(PY) -m venv $(VENV)
	$(PIP) install -q -e "backend[dev,llm]"

frontend-setup:
	cd frontend && npm install

# Run API (:8000) and Vite dev server (:5173, proxying /api) together.
dev:
	@trap 'kill 0' EXIT; \
	  (cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) & \
	  (cd frontend && npm run dev) & \
	  wait

api:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

seed:
	cd backend && .venv/bin/python -m app.db.seed

test:
	cd backend && .venv/bin/python -m pytest -q

e2e:
	cd backend && .venv/bin/python -m pytest -q tests/test_e2e_smoke.py

build:
	cd frontend && npm run build

# Regenerate the frontend's API schema types from the live OpenAPI document.
gen-api:
	cd backend && .venv/bin/python -c "import json; from app.main import app; print(json.dumps(app.openapi()))" > ../frontend/openapi.json
	cd frontend && npx --yes openapi-typescript openapi.json -o src/api/schema.d.ts && rm openapi.json
