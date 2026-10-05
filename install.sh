#!/usr/bin/env bash
#
# CaddyUI 一键安装脚本（Linux + systemd）
#
#   curl -fsSL https://raw.githubusercontent.com/lqlcj/CaddyUI/main/install.sh | sudo bash
#
# 做这几件事：
#   1. 建 caddy 系统用户（面板和 Caddy 共用，省掉 socket 权限的麻烦）
#   2. 装 Caddy（已经装过就跳过）
#   3. 取 caddyui 二进制：优先下 Release，下不到就现场编译
#   4. 从老版本 Relay 平滑迁移（如果检测到的话）
#   5. 写 systemd 单元和引导配置
#   6. 启动服务并设为开机自启
#
# 脚本可以重复执行（等于升级），不会把已有数据弄丢。
#
# 可用环境变量：
#   PANEL_PORT=81      面板端口
#   PANEL_BIND=127.0.0.1  面板监听 IP；默认不开放公网
#   CADDYUI_REF=main   要安装的分支或 tag

set -euo pipefail

REPO="lqlcj/CaddyUI"
REF="${CADDYUI_REF:-${RELAY_REF:-main}}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

BIN=/usr/local/bin/caddyui
OLD_BIN=/usr/local/bin/relay
CADDY_BIN=/usr/bin/caddy
CADDY_ETC=/etc/caddy
SYSTEMD_DIR=/etc/systemd/system
DATA_DIR=/var/lib/caddyui
OLD_DATA_DIR=/var/lib/relay
HELPER_DIR=/usr/local/lib/caddyui
HELPER="$HELPER_DIR/upgrade-caddy.sh"
SUDOERS=/etc/sudoers.d/caddyui
PANEL_PORT="${PANEL_PORT:-81}"
PANEL_BIND="${PANEL_BIND:-127.0.0.1}"
GO_MIN=1.26.8
DEPLOY_SRC=""

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m警告:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：curl -fsSL ${RAW}/install.sh | sudo bash"
command -v systemctl >/dev/null 2>&1 || die "这个脚本需要 systemd"
command -v curl      >/dev/null 2>&1 || die "需要 curl，请先安装：apt install curl / yum install curl"
command -v tar       >/dev/null 2>&1 || die "需要 tar，请先安装"
command -v sha512sum >/dev/null 2>&1 || die "需要 sha512sum，请安装 coreutils"
command -v sha256sum >/dev/null 2>&1 || die "需要 sha256sum，请安装 coreutils"
command -v flock >/dev/null 2>&1 || die "需要 flock，请安装 util-linux"
command -v runuser >/dev/null 2>&1 || die "需要 runuser，请安装 util-linux"
[[ "$PANEL_PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$PANEL_PORT >= 1 && 10#$PANEL_PORT <= 65535 )) \
  || die "PANEL_PORT 必须是 1~65535"
[[ "$PANEL_BIND" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "PANEL_BIND 必须是 IPv4 地址"

TMP="$(mktemp -d /var/tmp/caddyui-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# ---------- 架构 ----------

case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv6l) ARCH=armv7 ;;
  *) die "不支持的 CPU 架构: $(uname -m)" ;;
esac
info "检测到架构：$ARCH"

# ---------- 源码目录（本地仓库里执行就直接用本地的） ----------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || echo .)"
if [ -f "$SCRIPT_DIR/go.mod" ] && [ -d "$SCRIPT_DIR/deploy" ]; then
  SRC="$SCRIPT_DIR"
  info "使用本地源码：$SRC"
else
  SRC=""
fi

# fetch <相对仓库根的路径> <目标文件>
fetch() {
  if [ -n "$DEPLOY_SRC" ] && [ -f "$DEPLOY_SRC/$1" ]; then
    cp "$DEPLOY_SRC/$1" "$2"
  elif [ -n "$SRC" ] && [ -f "$SRC/$1" ]; then
    cp "$SRC/$1" "$2"
  else
    curl -fsSL --retry 3 "$RAW/$1" -o "$2" || die "下载 $1 失败"
  fi
}

# ---------- 端口占用检查 ----------

if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :${PANEL_PORT}" 2>/dev/null | grep -q .; then
  # 老版本 relay 正占着这个端口是正常的（等下会被停掉），别虚报。
  if ! systemctl is-active --quiet relay 2>/dev/null; then
    warn "${PANEL_PORT} 端口已经被别的程序占用了，装完面板可能起不来。"
    warn "换个端口重装：PANEL_PORT=8081 curl -fsSL ${RAW}/install.sh | sudo bash"
  fi
fi

# ---------- 用户 ----------

if id caddy >/dev/null 2>&1; then
  info "caddy 用户已存在"
else
  info "创建 caddy 系统用户"
  NOLOGIN="$(command -v nologin || echo /bin/false)"
  useradd --system --home-dir /var/lib/caddy --create-home \
          --shell "$NOLOGIN" --comment "Caddy / CaddyUI" caddy
fi

# ---------- Caddy ----------

if [ -x "$CADDY_BIN" ]; then
  info "Caddy 已安装：$("$CADDY_BIN" version 2>/dev/null | head -1)"
else
  info "正在下载 Caddy……"
  URL="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
        | grep -oE "https://github.com/caddyserver/caddy/releases/download/[^\"]+_linux_${ARCH}\.tar\.gz" \
        | head -1)"
  [ -n "$URL" ] || die "没找到 Caddy 的下载地址，请手动安装 Caddy 后重新运行本脚本"

  curl -q -fsSL --proto '=https' --proto-redir '=https' --retry 3 "$URL" -o "$TMP/caddy.tar.gz" || die "下载 Caddy 失败"
  tag="${URL%/*}"
  tag="${tag##*/}"
  [[ "$tag" =~ ^v2\.[0-9]+\.[0-9]+$ ]] || die "只支持 Caddy 2 稳定版"
  archive="${URL##*/}"
  curl -q -fsSL --proto '=https' --proto-redir '=https' --retry 3 \
    "https://github.com/caddyserver/caddy/releases/download/$tag/caddy_${tag#v}_checksums.txt" \
    -o "$TMP/caddy-checksums.txt" || die "下载 Caddy 校验和失败"
  expected="$(awk -v name="$archive" '$2 == name {print $1}' "$TMP/caddy-checksums.txt")"
  [[ "$expected" =~ ^[0-9a-fA-F]{128}$ ]] || die "Caddy 校验和格式错误"
  actual="$(sha512sum "$TMP/caddy.tar.gz" | awk '{print $1}')"
  [ "${expected,,}" = "$actual" ] || die "Caddy 校验和不匹配"
  tar -xOzf "$TMP/caddy.tar.gz" caddy > "$TMP/caddy"
  install -m 0755 "$TMP/caddy" "$CADDY_BIN"
  info "Caddy 安装完成：$("$CADDY_BIN" version | head -1)"
fi

# ---------- caddyui 二进制 ----------

# 先试 Release 里的预编译版本，省掉在小机器上编译的痛苦。
get_release() {
  # A local checkout or explicit ref must use its matching source.
  [ -z "$SRC" ] && [ "$REF" = main ] || return 1
  info "尝试下载预编译的 caddyui……"
  curl -q -fsSL --proto '=https' --proto-redir '=https' --max-time 60 \
    "https://github.com/${REPO}/releases/latest/download/SHA256SUMS" -o "$TMP/SHA256SUMS" || return 1
  for name in "caddyui-linux-${ARCH}" "relay-linux-${ARCH}"; do
    local url="https://github.com/${REPO}/releases/latest/download/${name}"
    if curl -fsSL --retry 2 --max-time 180 "$url" -o "$TMP/caddyui" 2>/dev/null; then
      local expected actual
      expected="$(awk -v name="$name" '$2 == name {print $1}' "$TMP/SHA256SUMS")"
      actual="$(sha256sum "$TMP/caddyui" | awk '{print $1}')"
      [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] && [ "${expected,,}" = "$actual" ] || return 1
      curl -q -fsSL --proto '=https' --proto-redir '=https' --max-time 60 \
        "https://github.com/${REPO}/releases/latest/download/caddyui-deploy.tar.gz" \
        -o "$TMP/deploy.tar.gz" || return 1
      expected="$(awk '$2 == "caddyui-deploy.tar.gz" {print $1}' "$TMP/SHA256SUMS")"
      actual="$(sha256sum "$TMP/deploy.tar.gz" | awk '{print $1}')"
      [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] && [ "${expected,,}" = "$actual" ] || return 1
      mkdir -p "$TMP/release-deploy"
      tar -xzf "$TMP/deploy.tar.gz" -C "$TMP/release-deploy" || return 1
      for file in upgrade-caddy.sh upgrade-request.sh caddyui-upgrade.socket caddyui-upgrade@.service caddy.service caddyui.service; do
        [ -f "$TMP/release-deploy/deploy/$file" ] || return 1
      done
      DEPLOY_SRC="$TMP/release-deploy"
      chmod +x "$TMP/caddyui"
      if "$TMP/caddyui" -version >/dev/null 2>&1; then
        info "下载成功：$("$TMP/caddyui" -version)"
        return 0
      fi
    fi
  done
  return 1
}

# 版本比较：$1 >= $2 返回 0
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

ensure_go() {
  if command -v go >/dev/null 2>&1; then
    local have
    have="$(go version | awk '{print $3}' | sed 's/^go//')"
    if ver_ge "$have" "$GO_MIN"; then
      GO=go
      return 0
    fi
    warn "系统里的 Go 是 $have，需要 $GO_MIN 以上，另外下一份临时的"
  fi

  local gover
  gover="$(curl -fsSL --max-time 20 'https://go.dev/dl/?mode=json' 2>/dev/null \
          | grep -oE '"version": *"go[0-9.]+"' | head -1 | grep -oE 'go[0-9.]+')"
  gover="${gover:-go${GO_MIN}}"

  local garch="$ARCH"
  [ "$garch" = "armv7" ] && garch=armv6l

  info "下载 Go 工具链（${gover}，约 80MB，只用于这次编译）……"
  curl -fsSL --retry 3 "https://dl.google.com/go/${gover}.linux-${garch}.tar.gz" -o "$TMP/go.tar.gz" \
    || die "下载 Go 失败，装不了。建议等 Release 构建完成后重试。"
  tar -xzf "$TMP/go.tar.gz" -C "$TMP"
  GO="$TMP/go/bin/go"
}

build_from_source() {
  DEPLOY_SRC=""
  warn "没有可用的预编译版本，改为在本机编译。"

  local mem
  mem="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "$mem" -gt 0 ] && [ "$mem" -lt 900 ]; then
    warn "本机内存只有 ${mem}MB，编译很可能被 OOM 杀掉。建议先加个 swap 再重试。"
  fi

  if [ -n "$SRC" ]; then
    cp -r "$SRC" "$TMP/src"
  else
    info "下载源码……"
    curl -fsSL --retry 3 "https://codeload.github.com/${REPO}/tar.gz/${REF}" -o "$TMP/src.tar.gz" \
      || die "下载源码失败"
    mkdir -p "$TMP/src"
    tar -xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1
  fi

  # Install service files from the same source tree that produced the binary.
  DEPLOY_SRC="$TMP/src"

  ensure_go

  if [ ! -f "$TMP/src/web/dist/index.html" ]; then
    command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 \
      || die "源码构建需要 Node.js 22.12+（推荐 24 LTS）和 npm。请安装后重试，或等待预编译 Release。"
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' \
      || die "Node.js 版本过旧，源码构建需要 22.12+（推荐 24 LTS）。"
    info "构建 React 前端……"
    ( cd "$TMP/src/frontend" && npm ci --cache "$TMP/npm-cache" && npm run build ) \
      || die "前端构建失败"
  fi

  info "编译中，第一次要拉依赖，可能要几分钟……"
  ( cd "$TMP/src" \
    && env HOME="$TMP" GOFLAGS=-mod=mod GOTOOLCHAIN=local \
           GOPROXY="https://goproxy.cn|https://proxy.golang.org|direct" \
           CGO_ENABLED=0 GOOS=linux \
           "$GO" build -ldflags="-s -w" -o "$TMP/caddyui" . ) || die "编译失败"
  info "编译完成"
}

get_release || build_from_source

# ---------- 从老版本 Relay 迁移 ----------
#
# 面板改名了，二进制、服务名、数据目录都跟着变。这一段负责让升级上来的机器
# 不丢数据、也不留下两个抢同一个端口的服务。

MIGRATED=0
if [ -f "$SYSTEMD_DIR/relay.service" ] || [ -x "$OLD_BIN" ]; then
  info "检测到旧版 Relay，开始迁移……"
  systemctl disable --now relay >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/relay.service"
  MIGRATED=1
fi

install -d -o caddy -g caddy -m 0750 "$DATA_DIR"

# 老数据库搬过来。用 cp 不用 mv：万一新版本有问题，老目录还在原地能退回去。
if [ -f "$OLD_DATA_DIR/relay.db" ] && [ ! -f "$DATA_DIR/caddyui.db" ] && [ ! -f "$DATA_DIR/relay.db" ]; then
  info "迁移数据库 $OLD_DATA_DIR/relay.db → $DATA_DIR/caddyui.db"
  # WAL 模式下这三个文件要一起搬，只搬主库可能丢掉最后几次写入。
  for suffix in "" "-wal" "-shm"; do
    [ -f "$OLD_DATA_DIR/relay.db${suffix}" ] && \
      cp -p "$OLD_DATA_DIR/relay.db${suffix}" "$DATA_DIR/caddyui.db${suffix}"
  done
  chown -R caddy:caddy "$DATA_DIR"
  info "旧目录 $OLD_DATA_DIR 原样保留，确认新版本没问题后可以自行删除"
fi

info "安装 caddyui 到 $BIN"
systemctl stop caddyui 2>/dev/null || true
install -m 0755 "$TMP/caddyui" "$BIN"
rm -f "$OLD_BIN"

# ---------- 目录与引导配置 ----------

install -d -o caddy -g caddy -m 0700 /var/lib/caddy
install -d -m 0755 "$CADDY_ETC"

# 引导配置只在 Caddy 从来没有被下发过配置时用一次。这里用 unix socket，
# 比监听回环 TCP 端口更严实——本机的其它进程连端口都扫不到。
if [ ! -f "$CADDY_ETC/bootstrap.Caddyfile" ]; then
  info "写入 $CADDY_ETC/bootstrap.Caddyfile"
  cat > "$CADDY_ETC/bootstrap.Caddyfile" <<'EOF'
# Caddy 引导配置 —— 只在全新安装、还没有任何配置时被读取一次。
# 之后 CaddyUI 面板会通过 Admin API 接管全部配置。
{
	admin unix//run/caddy/admin.sock
}
EOF
else
  info "引导配置已存在，跳过"
fi

# ---------- 升级助手（面板里那个「升级 Caddy 内核」按钮） ----------
#
# 面板以非特权的 caddy 用户运行，写不了 /usr/bin/caddy 也重启不了服务。
# 独立的 systemd 服务执行升级，面板通过仅 caddy 组可访问的 Unix socket 请求。
#
# 脚本不接受任何参数 —— 下载哪个仓库、什么版本、校验和对不对全由它自己决定，
# 所以这条授权给出去的能力只有「把 Caddy 升级到官方最新版」这一件事。
# 详细理由写在 deploy/upgrade-caddy.sh 的注释里。

info "安装 Caddy 升级助手"
fetch deploy/upgrade-caddy.sh "$TMP/upgrade-caddy.sh"

# 目录和脚本都必须 root 所有：只要 caddy 用户能改这个文件，
# 独立升级服务就会执行被替换的代码。
install -d -o root -g root -m 0755 "$HELPER_DIR"
install -o root -g root -m 0755 "$TMP/upgrade-caddy.sh" "$HELPER"

fetch deploy/upgrade-request.sh "$TMP/upgrade-request.sh"
install -o root -g root -m 0755 "$TMP/upgrade-request.sh" "$HELPER_DIR/upgrade-request.sh"
for unit in caddyui-upgrade.socket caddyui-upgrade@.service; do
  fetch "deploy/$unit" "$TMP/$unit"
  install -o root -g root -m 0644 "$TMP/$unit" "$SYSTEMD_DIR/$unit"
done
# Remove the obsolete privilege path when upgrading an existing installation.
rm -f "$SUDOERS"

# ---------- systemd ----------

info "安装 systemd 单元"
fetch deploy/caddy.service   "$TMP/caddy.service"
fetch deploy/caddyui.service "$TMP/caddyui.service"

install -m 0644 "$TMP/caddy.service" "$SYSTEMD_DIR/caddy.service"

# 面板端口允许通过环境变量 PANEL_PORT 覆盖
sed "s|-listen 127.0.0.1:81|-listen ${PANEL_BIND}:${PANEL_PORT}|" \
    "$TMP/caddyui.service" > "$SYSTEMD_DIR/caddyui.service"
chmod 0644 "$SYSTEMD_DIR/caddyui.service"

systemctl daemon-reload
systemctl enable --now caddyui-upgrade.socket
systemctl reset-failed relay >/dev/null 2>&1 || true
systemctl enable --now caddy
sleep 1
systemctl enable caddyui >/dev/null 2>&1 || true
systemctl restart caddyui || true
sleep 2

# ---------- 收尾 ----------

echo
if systemctl is-active --quiet caddy && systemctl is-active --quiet caddyui; then
  info "安装完成！"
  echo
  echo "    监听地址:  http://${PANEL_BIND}:${PANEL_PORT}"
  echo "    SSH 隧道: ssh -N -L 8081:127.0.0.1:${PANEL_PORT} <SSH用户>@<服务器IP>"
  echo "    隧道连接后打开: http://127.0.0.1:8081"
  echo "    首次注册口令: 在服务器执行 sudo cat /var/lib/caddyui/setup-token"
  if [ "$MIGRATED" = "1" ]; then
    echo "    已从 Relay 升级，站点和账号都在。会话被清空了，需要重新登录一次。"
  else
    echo "    第一次打开会让你用邮箱创建管理员账号，这个邮箱同时会作为证书联系邮箱。"
  fi
  echo
  echo "  公网站点按需放行 80、443；面板端口无需开放公网。日常管理请使用 HTTPS 或 SSH 隧道。"
else
  warn "有服务没能启动，看一下日志："
  echo "    journalctl -u caddy -n 50 --no-pager"
  echo "    journalctl -u caddyui -n 50 --no-pager"
  exit 1
fi
