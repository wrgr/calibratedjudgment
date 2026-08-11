PY ?= python3
VENV = backend/.venv
PIP = $(VENV)/bin/pip
PYTHON = $(VENV)/bin/python

.PHONY: setup backend-setup frontend-setup dev api web seed test e2e build build-static preview-static gen-api gen-demo

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

# Backend-free static build (what GitHub Pages ships): the browser is its own
# backend — bundled demo data + client-side grading with a bring-your-own key.
build-static:
	cd frontend && VITE_STATIC=1 npm run build

# Serve the static build locally to smoke-test the Pages bundle.
preview-static: build-static
	cd frontend && npm run preview

# Regenerate the bundled demo fixtures the static build ships with (run after
# editing content/exemplars, the rubric, or the seed users). No DB or network.
gen-demo:
	$(PY) scripts/gen_demo_fixtures.py

# Regenerate the frontend's API schema types from the live OpenAPI document.
gen-api:
	cd backend && .venv/bin/python -c "import json; from app.main import app; print(json.dumps(app.openapi()))" > ../frontend/openapi.json
	cd frontend && npx --yes openapi-typescript openapi.json -o src/api/schema.d.ts && rm openapi.json
