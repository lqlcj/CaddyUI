# CaddyUI

超轻量反向代理面板。用起来像 Nginx Proxy Manager，但只有两个静态二进制文件。

填个域名，填个端口，点保存 —— HTTPS 证书自动申请、自动续期，不用碰任何配置文件。

```
┌──────────────┐   unix socket    ┌──────────────┐
│   caddyui    │ ───────────────► │    caddy     │ ◄── 80 / 443 真实流量
│   控制面      │   POST /load     │    数据面     │
│  (这个项目)   │                  │  (官方原版)   │
└──────┬───────┘                  └──────┬───────┘
       │                                 │
  caddyui.db                      /var/lib/caddy
  站点·账号·配置历史                 证书·ACME 账户
```

**面板挂了，反代照跑。** 这是刻意的设计：控制面和数据面是两个独立进程。面板崩溃、
升级、被 OOM Killer 杀掉，甚至数据库删了，正在跑的流量都不受任何影响 ——
Caddy 会用自己保存的配置继续工作。

---

## 一键安装

Linux + systemd，root 执行：

```bash
curl -fsSL https://raw.githubusercontent.com/lqlcj/CaddyUI/main/install.sh | sudo bash
```

默认只监听 `127.0.0.1:81`。在自己的电脑执行
`ssh -N -L 8081:127.0.0.1:81 <SSH用户>@<服务器IP>`，然后打开 `http://127.0.0.1:8081`。
首次注册先在服务器执行 `sudo cat /var/lib/caddyui/setup-token` 取得初始化口令，
再用口令和邮箱创建唯一管理员。未初始化时每次重启都会生成新口令；已有账号不受影响。
注册邮箱同时作为 HTTPS 证书的联系邮箱，但不能替代证书到期监控。
然后「添加站点」填域名和转发目标，保存即可，证书会自动签发。

- 公网站点按需开放 **80 / 443**，面板 **81** 端口无需开放公网。
- 想换端口：把命令改成 `curl -fsSL .../install.sh | sudo PANEL_PORT=8081 bash`
- 重复运行会更新面板、升级助手和服务文件，保留数据库。请先备份自定义服务配置。
- 日常使用可以把面板反代成 HTTPS 域名；域名不可用时通过 SSH 隧道救援。
  新安装和重新运行安装脚本默认使用回环地址。确实需要其他绑定地址时显式设置 `PANEL_BIND`。
- 安装脚本会启用 `caddyui-upgrade.socket`，通过受文件权限保护的 Unix socket
  请求独立的 root 服务升级 Caddy。不需要 sudo，面板仍保留沙箱限制。
  不需要此功能时执行 `sudo systemctl disable --now caddyui-upgrade.socket`。

### 从旧版 Relay 升级

直接跑上面那条安装命令就行。脚本会自动停掉 `relay` 服务、把
`/var/lib/relay/relay.db` 复制成 `/var/lib/caddyui/caddyui.db`、装上新的
`caddyui.service`。站点、账号、配置历史都在，旧目录原样保留着以防万一。

只有一点：会话 cookie 换了名字，**需要重新登录一次**。

## 一键卸载

```bash
curl -fsSL https://raw.githubusercontent.com/lqlcj/CaddyUI/main/uninstall.sh | sudo bash
```

停掉并删除 CaddyUI、Caddy、systemd 单元、数据库和证书。执行前有 5 秒倒计时，
按 Ctrl+C 可以取消。想保留数据和证书（比如只是重装），在 `sudo` 后面加 `KEEP_DATA=1`。

---

## 功能

### 站点（七层反向代理）

域名 → 上游服务。自动 HTTPS、强制跳转、访问密码、自定义 Caddyfile 片段。

编辑站点时能直接看到**这个域名的证书和私钥在服务器上的绝对路径**，还有有效期和
颁发者。要把证书拿去给别的服务用（MySQL、邮件服务器、Nginx）时，点一下复制就行。
路径是扫描磁盘得到的真实文件，不是按规则拼出来的。

> 证书续期后文件**原地更新、路径不变**，所以引用它的程序记得配成定期重载。

停用站点会保留设置和证书，之后可以重新启用。删除站点会移除站点记录并下发新配置；
删除确认框可勾选「同时清理该站点独占的证书、私钥和元数据」，默认保留证书。
清理只在配置成功发布后执行，只处理 Caddy 标准证书目录中的 `.crt`、`.key`、`.json` 文件。
其他站点（包括已停用站点）共用的证书、包含其他域名的证书、无法解析的证书会保留；
其他站点存在自定义配置时也会跳过清理。上游应用、网站文件、DNS、ACME 账户和配置历史不受影响。
面板无法检测外部程序对证书的引用；如果其他服务使用了这些路径，请不要勾选清理。
清理后的证书文件无法通过配置历史恢复，重新启用相关配置可能需要重新申请证书。
若配置发布或证书清理失败，页面会提示；后续「重新下发」只发布配置，不会自动补做证书清理。
> 私钥通常为 0600、属主 caddy，caddy 用户和 root 都能读取。

### 升级 Caddy 内核

设置页可以升级到执行时的官方最新稳定版 Caddy 2。

只从 **Caddy 官方 GitHub 仓库** `caddyserver/caddy` 下载，装之前用官方发布的
**SHA-512 校验和**核对，对不上直接放弃。助手拒绝额外插件、包管理器安装、降级、
预发布版本及跨大版本升级。仅支持标准 `/usr/bin/caddy` 安装和随项目提供的服务配置。
先用新内核以 caddy 用户身份验证实际的 `autosave.json`，再备份内核和配置、原子替换，
用 `--resume` 重启。检查服务和 Admin API 持续正常，失败则尝试恢复旧内核及配置；
恢复未确认成功会明确报错。网站会短暂中断，升级后仍应检查实际业务。
旧内核保存在 `/usr/bin/caddy.bak`，配置备份在 `/var/lib/caddyui-upgrade/config.json.bak`。

**更新 Caddy 不会更新面板、升级助手或系统组件。** 少更新代码的维护建议见 [SECURITY.md](SECURITY.md)，
本次检查范围、发现及验证结果见 [AUDIT.md](AUDIT.md)。

**这里有个权限问题值得说清楚。** 面板以非特权的 `caddy` 用户运行，它写不了
`/usr/bin/caddy`，也重启不了服务。要做到点一下就升级，就得给它一点特权 ——
给多少、怎么给是关键：

安装脚本会放一个 root 拥有的助手脚本 `/usr/local/lib/caddyui/upgrade-caddy.sh`，
由 `caddyui-upgrade@.service` 独立执行。面板只能通过 root:caddy、0660 权限的
`/run/caddyui-upgrade.sock` 请求检查或升级。**升级脚本不接受任何参数** ——
下载哪个仓库、什么版本、校验和对不对，全部由脚本自己决定，面板插不上手。

升级入口只接受固定操作，不接受任意路径或命令。面板管理员仍能控制 Caddy 的全部配置，
面板被攻破会危及托管站点和 caddy 用户可读的数据；这不是多租户隔离边界。

反过来，如果助手设计成「装我给你的这个文件」，面板就能喂给它任意二进制，
等于直接送 root。这条边界不能松，改那个脚本之前请先读它开头的注释。

升级 socket 没有启用、权限不正确或服务无响应时，设置页显示「一键升级不可用」。
面板保留 `NoNewPrivileges=true` 和 `ProtectSystem=full`，不在面板进程内提权。
更新已有安装时需要重新运行安装脚本，安装新服务并移除旧 sudoers 授权。
包管理器装的 Caddy 也会被助手拒绝接管，让你走 `apt upgrade caddy`。

### 界面

配色跟 Claude 一套：暖米白底 + 赤陶橙点缀。右上角可以切深色模式，
默认跟随系统。主题存在 cookie 里由服务端渲染，所以刷新页面不会先闪一下白底。



---

### 将 CaddyUI 81 端口改为仅本机监听

如果已经通过 Caddy 将 CaddyUI 反向代理到域名，建议将 CaddyUI 的 `81` 端口修改为仅监听本机，避免管理面板直接暴露在公网。

编辑 CaddyUI 的 systemd 服务文件：

```
nano /etc/systemd/system/caddyui.service
```

找到：

```
-listen 0.0.0.0:81
```

修改为：

```
-listen 127.0.0.1:81
```

保存并退出后，重新加载 systemd 并重启 CaddyUI：

```
systemctl daemon-reload
systemctl restart caddyui
```

检查监听状态：

```
ss -lntp | grep :81
```

正常情况下应显示：

```
127.0.0.1:81
```

而不是：

```
0.0.0.0:81
```

修改完成后，CaddyUI 只能通过本机访问，公网无法直接访问 `IP:81`，但通过 Caddy 反向代理的域名仍可正常访问。

---



跑一个站点，空闲状态：

| 进程      | 工作集   | 说明                          |
| --------- | -------- | ----------------------------- |
| `caddy`   | 31.2 MB  | `GOMEMLIMIT=64MiB GOGC=50`    |
| `caddyui` | 13.9 MB  | `GOMEMLIMIT=64MiB GOGC=50`    |
| **合计**  | **~45 MB** | 128 MB 内存的小机器绰绰有余  |

> **`GOMEMLIMIT` 不是可选项。** 不设的话面板常驻 55 MB（Go 的 GC 不着急把
> 内存还给系统），设了之后 14 MB。仓库里的 systemd 单元已经写好了。

二进制体积：`caddyui` 13 MB（`-ldflags="-s -w"` 后），`caddy` 官方版约 45 MB。

---

## 工作原理

站点部分的核心就三步，加起来不到 200 行：

**1. 把数据库里的站点渲染成 Caddyfile**（`internal/caddy/render.go`）

```caddyfile
{
	admin unix//run/caddy/admin.sock
	email you@example.com
}

# 我的博客
blog.example.com, www.blog.example.com {
	reverse_proxy http://127.0.0.1:3000 {
		header_up X-Real-IP {client_ip}
	}
}
```

**2. POST 给 Caddy**（`internal/caddy/client.go`）

配置加载是**原子的**。Caddy 拒绝新配置时继续运行旧配置；但语法正确不代表业务正确，
错误的上游、域名、访问策略仍可能使网站不可用。网络超时也可能导致面板无法确认加载结果。

**3. 每次下发都存一份快照**（`internal/store/versions.go`）

配置页有完整历史，点一下就回滚到任意一个成功过的版本。改崩了不用 SSH 上去翻文件。

### 安全上做了什么

- 域名和主机名入库前过**白名单正则**，空格、大括号、换行一律拒绝 —— 杜绝 Caddyfile 注入
- 邮箱同样过白名单正则才写进 Caddyfile 的 `email` 指令
- 「高级配置」原样透传，只适合可信管理员；括号检查不是隔离边界，语法及业务行为需自行核对
- 登录限速：同 IP 5 分钟 10 次、全局 100 次；账号不存在时也跑一次 bcrypt，防时序探测
- 已登录的修改操作校验 CSRF token 和同源信息；登录校验同源信息，初始化额外要求服务器口令
- CSP `default-src 'self'`，面板没有任何外部资源、没有内联脚本
  （深色模式因此走 cookie + 服务端渲染，而不是内联 script）
- Admin API 走 unix socket，本机其它进程连端口都扫不到
- 证书那块只读路径和有效期，**证书内容和私钥永远不会出现在页面上**
- 升级 Caddy 只走官方仓库 + SHA-512 校验；面板的升级 socket 权限被限死在
  「运行那一个不带参数的助手脚本」上，换不成任意命令

---

## 目录结构

```
install.sh                   一键安装（含从 Relay 迁移）
uninstall.sh                 一键卸载
main.go                      启动、优雅退出、内嵌前端
internal/
  store/                     SQLite：用户、站点、配置版本、会话
  caddy/
    client.go                Admin API 客户端（unix socket / TCP 都支持）
    render.go                站点 → Caddyfile
  certs/                     在磁盘上定位 Caddy 签发的证书，读有效期
  caddybin/                  读 Caddy 版本、查官方最新版、触发升级
  app/service.go             渲染 + 下发 + 记录版本 + 回滚
  web/                       路由、会话、CSRF、主题、各页面 handler
frontend/
  src/pages/                 React 页面：登录、站点、配置、设置
  src/components/ui/         shadcn/ui 组件（Radix + Tailwind CSS）
  src/lib/                   页面数据、请求和类型定义
  tests/                     Playwright 浏览器回归测试
web/dist/                    Vite 构建产物，嵌入 Go 二进制
deploy/
  caddy.service              Caddy 的 systemd 单元
  caddyui.service            面板的 systemd 单元
  upgrade-caddy.sh           root 拥有的升级助手
  upgrade-request.sh         固定 CHECK / UPGRADE 请求处理
  caddyui-upgrade.socket     受文件权限保护的升级入口
  caddyui-upgrade@.service   独立 root 升级服务
  ```

前端使用 React 19、TypeScript、Vite、Tailwind CSS 和 shadcn/ui。
构建资源嵌入 Go 二进制，安装 Release 的服务器不需要 Node.js，也不需要单独部署前端。

## 本地开发与构建

源码构建需要 Go 1.26.8+、Node.js 22.12+（推荐 24 LTS）和 npm：

```sh
npm --prefix frontend ci
npm --prefix frontend run build
go test ./...
go build .
go run . -listen 127.0.0.1:8082 -data ./data/dev -caddy 127.0.0.1:12019
```

使用独立的开发 Caddy 实例；面板启动和保存站点时会同步配置。
前端热更新开发：先启动上述 Go 服务，再运行 `npm --prefix frontend run dev`，访问 Vite 输出的地址。
开发代理默认指向 `127.0.0.1:8082`，可用 `CADDYUI_DEV_BACKEND` 修改。

页面数据通过同一路由的 `Accept: application/json` 请求获取；表单仍由 Go 校验会话、CSRF 和参数。
前端不保存登录令牌，沿用 HttpOnly 会话 Cookie。普通访问返回 React 入口，深层页面支持直接刷新。

`npm --prefix frontend run check` 检查 TypeScript。
`npm --prefix frontend test` 运行浏览器测试；先安装测试浏览器：`cd frontend && npx playwright install chromium`。
一键安装优先使用预编译 Release；回退到源码编译时也需要 Node.js 和 npm。

## 启动参数

| 参数           | 环境变量               | 默认值           | 说明                          |
| -------------- | ---------------------- | ---------------- | ----------------------------- |
| `-listen`      | `CADDYUI_LISTEN`       | `127.0.0.1:81`  | 面板监听地址                  |
| `-data`        | `CADDYUI_DATA_DIR`     | `./data`         | 数据库存放目录                |
| `-caddy`       | `CADDYUI_CADDY_ADMIN`  | `127.0.0.1:2019` | Caddy Admin API 地址          |
| `-caddy-data`  | `CADDYUI_CADDY_DATA`   | 自动探测         | Caddy 数据目录（证书在这里）  |
| `-caddy-bin`   | `CADDYUI_CADDY_BIN`    | 自动探测         | Caddy 可执行文件路径          |

`-caddy` 支持两种写法：`127.0.0.1:2019`（TCP）或 `unix//run/caddy/admin.sock`。

旧的 `RELAY_*` 环境变量仍然认，方便从老版本平滑升级。

---

## 备份

要备份这些内容：`/var/lib/caddyui/caddyui.db`（站点、账号、配置历史）和
`/var/lib/caddy`（Caddy 的证书和 ACME 账户密钥）。

最后一项**特别容易被忘掉**。丢了会导致重装后所有证书要重新签发，而 Let's Encrypt
对同一组域名有**每周 5 张**的速率限制，撞上了就得干等几天。

## 常见问题

**证书申请不下来**
Caddy 用 HTTP-01 验证，需要 80 端口能被外网访问。检查域名解析有没有指到这台机器、
80 端口有没有被防火墙或云厂商安全组挡住。面板「配置」页能看到下发结果。

**站点编辑页看不到证书路径**
说明面板读不到 Caddy 的数据目录。「设置」页会显示它在找哪个目录。
一键安装装出来的两个服务同属 `caddy` 用户，正常情况下读得到；
手动部署的话用 `-caddy-data /实际/路径` 指定。域名还没被访问过时证书本来就不存在，
这种情况会显示「尚未签发」。

**通配符域名 `*.example.com` 证书签不出来**
通配符必须用 DNS-01 验证，需要对应 DNS 厂商的插件，得用 `xcaddy` 重新编译 Caddy，
然后在站点的「高级配置」里写上 `tls { dns cloudflare {env.CF_API_TOKEN} }`。
把这一步做成图形化配置在路线图里。

**面板显示「Caddy 未连接」**
多半是 Caddy 服务没起来，或者 admin 地址对不上 —— 面板的 `-caddy` 参数必须和
Caddy 实际监听的一致。一键安装脚本装出来的是匹配的。

**改配置把网站搞挂了**
Caddy 拒绝无效配置时保持旧配置；语法正确但上游或策略错误仍会影响网站。
可通过 SSH 隧道进入面板，在「配置」页回滚，然后修正站点记录。
历史回滚不恢复数据库；再次保存站点或重启面板可能覆盖回滚结果。

**WebSocket 要不要单独配置**
不用。Caddy 的 `reverse_proxy` 默认就转发 WebSocket 和 HTTP/2，
不像 nginx 那样要手写 `Upgrade` / `Connection` 头。

**面板打不开**
默认只监听本机。先通过 SSH 隧道访问，检查 `systemctl status caddyui`，
日常使用 HTTPS 反代域名。无需为了救援把 81 端口开放到公网。

**设置页显示「一键升级不可用」**
检查 `systemctl status caddyui-upgrade.socket`，确认升级入口已启用且 caddy 用户有访问权限。
重新跑一次安装脚本通常能修好。实在不行就 SSH 上去手动升级，
面板上会显示当前和最新版本，心里有数。

**升级 Caddy 失败了怎么办**
助手脚本在替换二进制之前会先备份、先试运行；重启后服务没起来会自动回滚并
重启回旧版本。设置页会把失败原因和日志尾巴显示出来。真出问题就
`journalctl -u caddy -n 50` 看详细日志。

---

## 路线图

已完成：

- [x] 站点增删改查、启用停用
- [x] 自动 HTTPS（申请 + 续期全自动）
- [x] 配置版本历史 + 一键回滚
- [x] HTTP Basic Auth 访问密码
- [x] 自定义 Caddyfile 片段（高级模式）
- [x] 启动自动同步、救援通道、登录限速、CSRF
- [x] 邮箱注册，自动作为证书联系邮箱（v0.2）
- [x] 证书 / 私钥路径与有效期展示（v0.2）
- [x] Claude 配色 + 深色模式（v0.2）
- [x] 一键升级 Caddy 内核，官方源 + SHA-512 校验（v0.2）

接下来：

- [ ] 上传自有证书
- [ ] DNS-01 图形化配置（Cloudflare / DNSPod / 阿里云）
- [ ] 跳转站点、静态文件站点
- [ ] IP 黑白名单
- [ ] 访问日志与简单统计
- [ ] 证书到期提醒（邮件 / Telegram / Bark）
- [ ] 一键备份恢复
- [ ] 多上游 + 健康检查
- [ ] 两步验证、审计日志

## Go 依赖

- `modernc.org/sqlite` —— 纯 Go 的 SQLite，不需要 CGO，交叉编译一条命令
- `golang.org/x/crypto` —— bcrypt（面板密码和站点访问密码共用）
