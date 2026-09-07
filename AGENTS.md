# Repository Guidelines

## Project Structure & Module Organization

CaddyUI is a Go control panel for Caddy. `main.go` wires services and embeds `web/` into the binary.

- `internal/store/`: SQLite users, sites, sessions, and configuration history.
- `internal/caddy/`: Admin API client and Caddyfile rendering.
- `internal/app/`: configuration synchronization, publication, and rollback.
- `internal/web/`: HTTP handlers, authentication, CSRF, and themes.
- `internal/certs/` and `internal/caddybin/`: certificate discovery and Caddy binary management.
- `web/templates/` and `web/static/`: Go HTML templates and handwritten CSS/JavaScript; no frontend build step.
- `deploy/`: systemd units, bootstrap configuration, sudoers policy, and upgrade helper. Root scripts handle installation/removal.

Tests live beside implementation files as `*_test.go`.

## Build, Test, and Development Commands

Use Go 1.25+ (`go.mod`). Run from the repository root:

- `go build .`: compile the panel with embedded frontend assets.
- `go run . -listen 127.0.0.1:8081 -data ./data -caddy 127.0.0.1:2019`: run locally against a separate development Caddy instance.
- `go test ./...`: run all Go tests.
- `go test ./internal/app -run TestSync`: run synchronization regression tests.
- `go vet ./...`: perform standard Go static checks.

Rebuild or restart after editing embedded assets. `.github/workflows/release.yml` cross-compiles Linux amd64, arm64, and armv7 binaries and publishes `latest` on pushes to `main`.

## Coding Style & Naming Conventions

Format Go changes with `gofmt`; use tabs, lowercase package names, exported `PascalCase` identifiers, and unexported `camelCase` identifiers. Follow existing two-space CSS/JavaScript indentation and nearby template formatting. Preserve server-rendered form behavior when adding JavaScript enhancements. Use LF line endings per `.gitattributes`. No dedicated frontend formatter or linter is configured.

## Testing Guidelines

Use Go's `testing` package with descriptive `TestBehavior` names. Follow existing `httptest` API mocks and `t.TempDir()` SQLite fixtures. Add regression coverage for behavioral fixes, particularly synchronization safeguards, configuration handling, and authentication. No minimum coverage percentage is configured; run the full suite before submitting.

## Commit & Pull Request Guidelines

History uses concise subjects, often in Chinese, alongside version-only release commits; no strict Conventional Commits pattern is established. Describe the change in each commit. PRs should explain the problem, behavior change, validation commands/results, and related issues. Include screenshots for UI changes and deployment notes for service or installer changes.

## Security & Configuration

Keep Caddy's Admin API on loopback or a Unix socket. Development startup can publish database configuration to Caddy, so use an isolated instance. Never commit runtime databases, certificates, or secrets. Preserve empty-database synchronization protection and Caddy's `--resume` startup behavior.
