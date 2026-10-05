# CaddyUI 安全与长期升级复核

日期：2026-10-05。基线：`7b705fb`，以及本次工作区修复。

结论：可以作为可信管理员自用的面板，在限制管理入口、保留备份和基本安全维护的前提下，
主要通过网页升级官方标准 Caddy 2。不能据此承诺永久不更新面板或绝对无漏洞。
本次已修改源码、部署脚本和回归测试，尚未发布 Release 或部署到实际服务器。

## 范围与环境

复核入口、认证/初始化、Cookie/CSRF、登录限速、SQLite 存取、站点输入、配置发布/回滚、
证书读取/清理、前端页面数据、内核下载/升级/失败恢复、安装/卸载脚本、systemd 和发布工作流。
使用 Windows amd64、Go 1.26.8、Edge，以及本机 WSL Debian/systemd。
测试数据库、Caddy API、升级脚本的文件系统和测试服务均隔离；未访问生产服务器。
实际服务器的公网暴露、管理员记录、已部署版本、插件、权限、备份和监控状态仍未确认。
用户后续确认面板部署在 VPS、通过 HTTPS 访问；这尚不能确认 81 端口和 Admin API 是否仅限本机。

## 发现与修复

| 项目 | 风险与触发条件 | 当前处理 |
| --- | --- | --- |
| 高：首次管理员抢注 | 空数据库且管理入口可达时，任何访客都能先注册 | 启动生成随机初始化口令，存入数据目录 `setup-token`，权限 0600；注册必须提供口令；默认回环监听 |
| 高：并发注册多个管理员 | 注册检查与插入分离，两个不同邮箱可同时成功 | 单条条件 INSERT 保证仅空库可插入；跨两个 SQLite 连接的并发回归要求恰好一个成功；查库失败不重新开放初始化 |
| 中：修改密码的会话撤销不可靠 | 原实现分开改密/删会话且忽略删除失败，登录也可与改密交错 | 改密与撤销会话放在同一事务；Web 登录/创建会话/改密串行；注入删除失败后验证密码没有半更新 |
| 中：升级覆盖插件或降级 | 原助手直接安装官方 latest，只检查版本是否相等 | 拒绝额外/未知插件、包管理器安装、降级、预发布及跨大版本；固定标准路径，拒绝符号链接和 caddy 可写的二进制 |
| 中：升级失败恢复不足 | 未预检运行配置，检查只看服务存活，部分恢复失败仍显示“已回滚” | 新内核以 caddy 身份验证实际 autosave；备份内核与配置；原子安装/恢复；检查 Admin API 和稳定 PID；恢复失败明确报告 |
| 中：配置发布的业务层缺少串行保护 | 已有 Web 配置锁，但直接并发调用 Apply/ApplyVersion/Sync 仍可交错 | 添加业务层发布锁及三条并发回归；升级任务运行期间拒绝面板配置修改 |
| 加固：代理头与同源检查 | 直接客户端可影响 X-Forwarded-Proto；同源只比较 Host；伪造格式的 XFF 可被当作 IP | 只信任 loopback 代理的 Proto/XFF；校验 IP；比较 scheme 与 Host；拒绝 cross-site 请求；恒定时间比较 CSRF/初始化口令 |
| 加固：限速资源上限 | 多来源可扩张限速表并触发大量 bcrypt | 全局登录预算与限速表硬上限；保留每 IP 限速 |
| 加固：下载及安装一致性 | 首次安装缺少显式 Caddy 校验；二进制和服务脚本可能来自不同源码状态 | 首装 Caddy 校验 SHA-512；Release 生成 SHA256SUMS 和配套部署包；面板校验后执行，部署文件与构建来源一致 |
| 加固：服务与升级结果 | 文件默认权限偏宽、面板可访问 /home 和 /root；断开后升级输出难追溯 | 服务 UMask=0077、面板 ProtectHome=true；升级输出写入 journal |
| 运维：不准确的承诺 | 文档把 ACME 联系邮箱当作到期提醒，把所有配置错误都描述成不影响线上 | 修正文档/提示，明确业务验证、外部到期监控、升级范围和失败恢复限制 |

没有删除已有账号，没有变更旧数据库迁移内容。若旧版曾被抢注，本次补丁不会清除入侵痕迹或自动恢复所有权。

## 已有有效防护

- 数据库查询使用参数绑定；登录密码和站点 Basic Auth 使用 bcrypt。
- 会话/CSRF 使用随机值，Cookie 设置 HttpOnly/SameSite；HTTPS 下使用 Secure。
- 11 个受保护 POST 路由均验证身份、CSRF 和来源；公开登录、初始化及主题端点分别处理来源检查。
- 请求体有大小限制，HTTP 有超时，页面数据禁止缓存；CSP 限制脚本来源和框架嵌入。
- 普通域名/上游字段校验后渲染；前端没有发现把不可信值写入原始 HTML 的路径。
- 证书接口只返回路径/元信息；私钥内容不进入页面数据。删除清理使用受限目录，并检查独占性、共享域名及自定义配置。
- 空数据库启动同步保护仍然保留；Caddy 服务仍用 `--resume`，没有重新引入会覆盖实际配置的 ExecReload。
- 旧审计 A4 的 sudo/NoNewPrivileges 冲突与 A5 的最后成功快照丢失，在本次开始前已修复；本次复核了相应实现和测试。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `go test ./...` | 通过，含注册、事务失败、发布并发、路由鉴权/CSRF、证书和历史回归 |
| `go vet ./...` | 通过 |
| `go build .` 与 Linux amd64 交叉构建 | 通过 |
| `govulncheck ./...`（工具 latest） | 0 个可达漏洞、0 个被导入包的漏洞；另有 1 个未使用模块包的提示，见下文 |
| `npm --prefix frontend ci` / audit | 0 个已报告漏洞 |
| `npm --prefix frontend run build` | TypeScript 与 Vite 构建通过 |
| Playwright，Edge | 完整工作流通过：新口令注册、登录、退出、改密码、站点操作、配置失败/回滚、证书与主题；21.1 秒 |
| 官方 Caddy 2.11.7 配置验证 | 8 类配置及两种 Admin 地址通过；包括 HTTP/HTTPS、IPv6 上游、自签上游选项、Basic Auth 和高级片段 |
| `deploy/test-upgrade-helper.py` | 9 项 chroot 测试通过，含多个子场景；拒绝异常版本/插件/包管理器/校验和/不兼容配置，成功升级和启动/健康/恢复失败 |
| `deploy/test-upgrade-service.sh` | WSL 的真实 systemd 上通过：受限调用方、独立 root 助手、固定命令、未授权用户拒绝 |
| 安装/升级脚本 `bash -n` | 通过 |
| `git diff --check` | 通过 |

界面截图位于本地 `frontend/test-results/dashboard-React-dashboard--924e2-and-configuration-workflows/`，
包含 `setup-security.png` 和各页面不同尺寸截图；这些测试产物不提交仓库。

`golang.org/x/crypto` 从 v0.54.0 更新至 v0.56.0，消除了三条 SSH 模块提示（本项目原本也不调用 SSH）。
剩余 GO-2026-5932 涉及该模块中废弃且不安全的 `openpgp` 包；本项目只使用 bcrypt，没有导入/调用 OpenPGP。
这不是发现一个本项目可被利用的漏洞，也不等于所有组件今后不会出现漏洞。

官方版本元数据核对：<https://github.com/caddyserver/caddy/releases/tag/v2.11.7>。
下载 Windows 版后先核对同一官方 Release 的 SHA-512，再用于配置验证。

## 仍需明确的边界

1. 本次没有对生产系统做渗透测试，也没有完整执行安装脚本或在真实业务 Caddy 上切换版本。
   升级故障测试执行真实助手脚本，但其下载、服务和 Caddy 命令由 chroot 中的替身提供；
   systemd 测试验证真实权限链，Caddy 配置测试验证真实解析器，三者不能替代部署后的业务验收。
2. 没有验证真实 ACME 申请/续期、DNS、外网流量、CDN 代理链、服务器权限或实际证书到期状态。
   未运行 Go race 检测：当前 Windows Go 环境 CGO=0、没有 C 编译器；并发顺序使用受控回归验证。
3. 面板管理员拥有完整 Caddy 配置权限。高级片段可访问本机资源；面板与 Caddy 同用户，因此不隔离私钥和 ACME 密钥。
   这适用于可信管理员自用，不适用于向不可信用户开放。VPN/SSH 隧道能显著缩小管理入口暴露面。
4. 原子配置加载不保证业务正确；超时也可能导致加载结果未知。历史回滚不还原数据库，重启面板/保存站点会重新同步数据库。
5. 网页升级有重启中断，只检查启动状态，不验证每个站点；断电、SIGKILL、磁盘或文件系统故障不能保证自动恢复。
   面板重启会丢失内存任务状态，因此升级时不要重启面板或并行运行安装/卸载。
6. HTTPS 加官方同源校验和仍信任 GitHub、上游账号和构建过程，不是独立签名或可重现构建证明。
7. 网页升级不会修补 CaddyUI、助手、操作系统。新增每周扫描仅在 GitHub Actions 实际运行时有效，不能替代维护和监控。

部署变更及建议维护频率详见 [SECURITY.md](SECURITY.md)。下方保留旧报告作为历史记录；旧报告中的未修复结论以本次复核为准。

---

# Historical audit — 2026-09-07

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
