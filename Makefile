.PHONY: install build build-mr build-frontend run run-binary run-server run-frontend stop status \
	lint lint-frontend lint-fix format format-check \
	test test-frontend test-frontend-coverage test-cov test-cov-check test-watch coverage \
	migrate migrate-diff migrate-apply migrate-hash \
	check ci clean help

.DEFAULT_GOAL := help

BINARY_NAME := markdown-review-server
BIN_DIR := bin
COVERAGE_FILE := coverage.out
# Minimum total coverage % for Go. Measured against production packages
# (internal/* + cmd/* are excluded for being either build-tagged or thin
# wiring; node_modules vendored Go files are excluded as external).
COVERAGE_THRESHOLD := 80
PORT ?= 8080
FRONTEND_PORT ?= 5174

FRONTEND_DIR := frontend

## install: Install Go modules and frontend deps
install:
	go mod download
	cd $(FRONTEND_DIR) && npm ci

## compose: No-op (frontend/ pre-composed during scaffold)
compose: ;

## build-frontend: Build the React SPA into internal/static/dist
build-frontend:
	cd $(FRONTEND_DIR) && npm run build
	@touch internal/static/dist/.gitkeep

## build: Build the monolithic binary (frontend + Go embed) and the mr CLI
build: build-frontend build-mr
	go build -o $(BIN_DIR)/$(BINARY_NAME) ./cmd/server

## build-mr: Build the mr CLI (review comments from the shell; no frontend dep)
build-mr:
	go build -o $(BIN_DIR)/mr ./cmd/mr

## run: Run Go (with hot reload via air, -tags dev) + Vite in parallel
run:
	$(MAKE) -j2 run-server run-frontend

## run-server: Run Go server with hot reload (uses -tags dev so embed is bypassed)
run-server:
	air

## run-frontend: Run Vite dev server (proxies /api to Go)
run-frontend:
	cd $(FRONTEND_DIR) && npm run dev

## run-binary: Run the built monolithic binary (no hot reload)
run-binary:
	./$(BIN_DIR)/$(BINARY_NAME)

## stop: Stop both Go and Vite dev servers
stop:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null || true
	@lsof -ti :$(FRONTEND_PORT) | xargs kill 2>/dev/null || true

## status: Check whether dev servers are running
status:
	@lsof -i :$(PORT) >/dev/null 2>&1 && echo "markdown-reviewer (Go): running (:$(PORT))" || echo "markdown-reviewer (Go): stopped"
	@lsof -i :$(FRONTEND_PORT) >/dev/null 2>&1 && echo "markdown-reviewer (Vite): running (:$(FRONTEND_PORT))" || echo "markdown-reviewer (Vite): stopped"

## lint: Run golangci-lint
lint:
	golangci-lint run

## lint-frontend: Run frontend linter
lint-frontend:
	cd $(FRONTEND_DIR) && npm run lint

## lint-fix: Auto-fix frontend lint issues
lint-fix:
	cd $(FRONTEND_DIR) && npm run lint:fix

## format: Format frontend code
format:
	cd $(FRONTEND_DIR) && npm run format

## format-check: Check frontend formatting
format-check:
	cd $(FRONTEND_DIR) && npm run format:check

## test: Run Go tests
test:
	go test ./...

## test-frontend: Run frontend tests
test-frontend:
	cd $(FRONTEND_DIR) && npm run test

## test-cov: Run Go tests with coverage on production packages
# Excludes:
#  - node_modules/** (vendored external Go files, e.g. flatted)
#  - internal/testutil (test-helper-only package)
#  - cmd/* (main wiring; no business logic)
test-cov:
	@PKGS=$$(go list ./... | grep -v node_modules | grep -v testutil | grep -v '/cmd/' | tr '\n' ',' | sed 's/,$$//'); \
	PKG_SPACES=$$(echo "$$PKGS" | tr ',' ' '); \
	go test -coverpkg="$$PKGS" -coverprofile=$(COVERAGE_FILE) $$PKG_SPACES
	go tool cover -func=$(COVERAGE_FILE) | tail -1

## test-cov-check: test-cov + fail if total < COVERAGE_THRESHOLD
test-cov-check: test-cov
	@TOTAL=$$(go tool cover -func=$(COVERAGE_FILE) | awk '/^total:/ {sub(/%/, "", $$3); print $$3}'); \
	if awk "BEGIN {exit !($$TOTAL < $(COVERAGE_THRESHOLD))}"; then \
		echo "ERROR: Go coverage $$TOTAL% < threshold $(COVERAGE_THRESHOLD)%"; \
		exit 1; \
	else \
		echo "OK: Go coverage $$TOTAL% >= threshold $(COVERAGE_THRESHOLD)%"; \
	fi

## test-watch: Run frontend tests in watch mode
test-watch:
	cd $(FRONTEND_DIR) && npm run test:watch

## coverage: Run frontend tests with coverage
coverage:
	cd $(FRONTEND_DIR) && npm run test:coverage

## check: Run all linters and tests (Go + frontend)
check: lint test lint-frontend test-frontend

## ci: Run lint + test with coverage gates (Go + frontend)
ci: lint test-cov-check lint-frontend test-frontend-coverage

## test-frontend-coverage: Frontend tests with the configured coverage gate
test-frontend-coverage:
	cd $(FRONTEND_DIR) && npm run test:coverage

## migrate: Apply migrations via GORM AutoMigrate (no atlas required)
migrate:
	go run ./cmd/migrate

## migrate-diff: Generate a new migration (requires atlas CLI)
migrate-diff:
	atlas migrate diff --env local

## migrate-apply: Apply pending migrations (requires atlas CLI)
migrate-apply:
	atlas migrate apply --env local

## migrate-hash: Rehash the migration directory (requires atlas CLI)
migrate-hash:
	atlas migrate hash --env local

## clean: Remove all build artifacts and caches (keeps composed frontend)
clean:
	rm -rf $(BIN_DIR)/ $(COVERAGE_FILE) app.db
	@if [ -d $(FRONTEND_DIR) ]; then rm -rf $(FRONTEND_DIR)/node_modules $(FRONTEND_DIR)/coverage; fi
	find internal/static/dist -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true

## help: Show this help
help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
