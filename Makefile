.PHONY: setup dev-api dev-web test lint format build docker-up docker-down logs health compose-check security-scan deploy-cloudflare
setup:
	cd api && python3 -m venv .venv && .venv/bin/pip install uv==0.9.15 && UV_CACHE_DIR=.uv-cache .venv/bin/uv sync --frozen --extra dev --python .venv/bin/python
	cd web && npm ci
	cd edge && npm ci

dev-api:
	cd api && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-web:
	cd web && npm run dev

test:
	cd api && .venv/bin/python -m pytest -q
	cd web && npm test
	cd edge && npm test

lint:
	cd api && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app
	cd web && npm run lint && npm run typecheck
	cd edge && npm run typecheck

format:
	cd api && .venv/bin/ruff format app tests

build:
	cd web && npm run build
	cd edge && npm run build && npm run dry-run

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

logs:
	docker compose logs -f --tail=100

health:
	curl -fsS http://localhost:8080/api/v1/health/ready

compose-check:
	docker compose config --quiet

security-scan:
	cd web && npm audit --omit=dev --audit-level=high
	cd edge && npm audit --omit=dev --audit-level=high

deploy-cloudflare: build
	cd edge && npx wrangler deploy
