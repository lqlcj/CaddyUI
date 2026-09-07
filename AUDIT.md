# CaddyUI Functionality and Security Audit

Date: 2026-09-07

Scope: the current working tree, including the uncommitted React migration.
Environment: Windows amd64, Go 1.26.5, installed Chrome, isolated temporary SQLite
databases and mock Caddy Admin APIs. No production instance was contacted.

The tested browser workflows pass. Deployment and concurrency findings prevent
an unconditional production-readiness conclusion. This audit made no application
fixes; temporary verification probes were removed after execution.

## Findings

### A1 - High: public initialization allows first-visitor administrator takeover

Locations: `deploy/caddyui.service:22`, `internal/web/auth.go:146`, `main.go:57`.

The installer exposes the panel on `0.0.0.0:81`. While the database has no users,
any reachable visitor can POST an email and password to `/setup` and become an
administrator. There is no installation secret or local-only enrollment gate.
Origin checking does not establish ownership: a direct HTTP client can omit
Origin and Referer. This applies to new installations and installations whose
user database has been lost, not ordinary initialized installations.

Impact: a remote visitor can claim the panel before its owner and change all
managed sites. Default HTTP access also sends credentials and non-Secure session
cookies without transport encryption when users log in through that address.

Evidence: route inspection and successful unauthenticated enrollment in isolated
tests. The existing browser regression also initializes without an enrollment
secret. No remote system was probed.

Recommendation: require a one-time cryptographic enrollment secret generated at
installation, or initialize through loopback/SSH before exposing the service.
Restrict the rescue port and use HTTPS for normal administration.

### A2 - High: simultaneous setup requests create additional administrators

Locations: `internal/web/auth.go:147`, `internal/store/users.go:89`.

The handler checks `UserCount()` before parsing the body and hashing the password.
`CreateUser` later performs an unconditional INSERT; only the email is unique.
Two requests can both observe zero users and insert different administrator
accounts. A single SQLite connection does not make these separate operations
atomic. A request whose body is delayed can pass the check before enrollment and
complete after the owner has registered.

Evidence: `TestAuditConcurrentSetup` gated two request bodies after the initial
count check. Both unauthenticated requests completed and `UserCount()` returned 2.
The probe used only a temporary database and in-process HTTP handlers.

Recommendation: enforce initial-account creation as one atomic database operation
with a checked outcome. Add a concurrency regression that requires exactly one
successful enrollment. An enrollment token alone does not enforce this invariant.

### A3 - High: concurrent publication can restore an older configuration

Locations: `internal/app/service.go:52`, `internal/app/service.go:74`.

Apply renders a database snapshot, sends `/load`, and records history without
serializing the publication sequence. Another mutation can publish a newer
snapshot before an earlier request reaches or completes its load. The earlier
request can then overwrite it. Both callers receive success while the database
and live Caddy configuration disagree. Rollback shares no publication lock either.

Evidence: `TestAuditApplyCanFinishWithStaleConfig` held the first mock `/load`,
changed a setting, completed the second Apply, then released the first. The
database contained the new value and the final loaded configuration the old one.
This proves overlapping, unversioned publication at the application boundary;
the test used a mock and did not measure real Caddy scheduling.

Recommendation: serialize snapshot generation, load, and history recording across
Apply, ApplyVersion, and Sync. Define ordering with database mutations and use
revision checks where needed. Add a controlled concurrent-publication regression.

### A4 - Medium: shipped service restrictions prevent one-click Caddy upgrades

Locations: `deploy/caddyui.service:41`, `deploy/caddyui.service:43`,
`internal/caddybin/caddybin.go:222`, `internal/caddybin/caddybin.go:270`.

The panel runs as user caddy with `NoNewPrivileges=true`, yet upgrades invoke
`sudo -n /usr/local/lib/caddyui/upgrade-caddy.sh`. Linux no_new_privs prevents sudo
from gaining root through its setuid bit even when the sudoers entry permits the
command. `ProtectSystem=full` additionally makes `/usr` read-only in the service
mount namespace, conflicting with replacement of `/usr/bin/caddy`.

HelperAvailable checks Linux, script presence, and sudo presence, so the UI can
advertise upgrades as available despite these restrictions. install.sh copies
the service and only substitutes the listening port; it does not resolve them.

Evidence: static cross-check of the shipped unit, installer, helper, and caller.
Not executed under Linux/systemd in this Windows audit.

Recommendation: use a narrowly authorized, separately managed privileged upgrade
service and expose its actual availability to the panel. Validate the installed
service path end to end; simply disabling NoNewPrivileges is insufficient.

### A5 - Medium: failed publications erase the last successful rollback snapshot

Locations: `internal/store/versions.go:38`, `internal/web/config.go:21`.

History pruning retains the latest 50 records without considering success.
After one good publication and 50 failed ones, the good snapshot is deleted.
The UI only lists 30 records, so a good snapshot can disappear from the available
rollback controls after 30 failures even before storage pruning removes it.

Evidence: `TestAuditFailedHistoryEvictsLastGood` inserted one successful version
followed by 50 failed versions. LastGoodConfig could no longer find a snapshot.

Recommendation: retain at least the last successful snapshot independently of
failed attempts, and always expose it in the rollback UI. Test both retention and
visibility with more failures than each configured limit.

### A6 - Medium: the audited compiler has known standard-library vulnerabilities

Locations: `go.mod:3`, `.github/workflows/release.yml:33`, `install.sh:38`.

`go run golang.org/x/vuln/cmd/govulncheck@latest ./...` reported six reachable
standard-library advisories in the local Go 1.26.5 build, fixed in Go 1.26.6:

| Advisory | Package / issue |
| --- | --- |
| GO-2026-6218 | net/url: quadratic resolvePath complexity |
| GO-2026-6091 | html/template: JavaScript regexp context tracking |
| GO-2026-6090 | crypto/tls: post-handshake message limits |
| GO-2026-6089 | net/http: ReadHeaderTimeout in unencrypted HTTP/2 checks |
| GO-2026-5972 | encoding/asn1: maximum recursion depth |
| GO-2026-5026 | net/http vendored IDNA: ASCII-only Punycode labels |

These are scanner call-graph matches, not six demonstrated remote exploits.
The embedded template is trusted and outbound update hosts are fixed, which
limits some attack paths. Production binary compiler versions were not inspected.
The release workflow selects its Go version from go.mod; the installer also
accepts old toolchains starting at 1.25.0, so neither establishes a current patch
baseline by itself.

Recommendation: rebuild with a currently supported patched Go toolchain (at least
1.26.6 on the scanned branch), verify actual release compiler metadata, and run
govulncheck in CI. Updating module dependencies alone cannot patch embedded stdlib.

## Verification Results

| Check | Result |
| --- | --- |
| `go test ./...` | Passed |
| `go vet ./...` | Passed |
| `npm --prefix frontend run build` | TypeScript check and Vite build passed |
| `npm --prefix frontend audit --json` | 0 reported dependency vulnerabilities |
| Browser regression with `PLAYWRIGHT_CHANNEL=chrome` | 1 comprehensive scenario passed |
| Protected route matrix | 7 GET and 11 POST routes require authentication |
| CSRF/origin route matrix | All 11 protected POST routes reject missing tokens and foreign origins |
| Isolated concurrency/history probes | A2, A3, A5 reproduced |
| govulncheck | 6 reachable standard-library advisories; scan failed |

The initial browser invocation could not launch because Playwright's bundled
Chromium was absent. Re-running with installed Chrome passed in 18.8 seconds.
The browser fixture compiles the embedded panel binary before running.

Browser coverage includes registration, login/logout, password change, site
creation/editing/deletion/toggling/filtering, basic-auth field persistence,
configuration apply/rollback and rejection messages, ACME settings, certificate
path refresh/copy, themes, and navigation. Layout assertions cover 320, 390, 768,
and 1440 pixel viewports. Desktop and narrow-mobile screenshots were also sampled
visually. Generated screenshots are under `frontend/test-results/`.

Existing Go coverage verifies empty-database startup protection and that private
key contents are not returned by certificate endpoints. Reviewed safeguards also
include parameterized SQL, bcrypt password hashing, random session/CSRF tokens,
HttpOnly/SameSite cookies, POST size limits, CSP, and authenticated mutations.

## Limits and Operational Behavior

- Real Caddy configuration parsing, TLS issuance/renewal, DNS reachability,
  forwarding traffic, and Linux installation/upgrade recovery were not exercised.
  The mock accepts configuration text without validating Caddyfile semantics.
- Rollback intentionally changes live configuration without restoring database
  site records. Startup Sync, saving a site, or applying settings can overwrite
  that rollback. The configuration page renders database intent, not a live
  configuration comparison. Account for this in recovery procedures.
- The public initialization window and HTTP rescue port depend on actual firewall
  exposure. A host-specific network audit is still required for a deployed panel.
- No claim is made that passing tests or a clean npm audit proves absence of all
  vulnerabilities. No application code was changed to resolve the findings.
