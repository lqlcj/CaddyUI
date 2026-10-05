#!/usr/bin/env bash
# Root-owned, argument-free helper for the standard CaddyUI installation.
# The socket caller cannot select a URL, binary, path, version or environment.
# All Caddy commands, including configuration validation, run as user caddy.
set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

API=https://api.github.com/repos/caddyserver/caddy/releases/latest
DL_BASE=https://github.com/caddyserver/caddy/releases/download
CADDY_BIN=/usr/bin/caddy
AUTOSAVE=/var/lib/caddy/.config/caddy/autosave.json
BACKUP=/usr/bin/caddy.bak
SERVICE=caddy
log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "必须由 root 或独立的升级服务运行"
[ "$#" -eq 0 ] || die "升级助手不接受参数"
for command in curl tar gzip sha512sum flock runuser timeout stat sort; do
  command -v "$command" >/dev/null || die "缺少命令：$command"
done
exec 9>/run/caddyui-upgrade.lock
flock -n 9 || die "已有升级任务正在运行"

# Never follow symlinks or execute an existing binary as root.
[ -f "$CADDY_BIN" ] && [ -x "$CADDY_BIN" ] && [ ! -L "$CADDY_BIN" ] \
  || die "仅支持 /usr/bin/caddy 的普通文件安装，不支持符号链接或自定义路径"
[ "$(stat -c %u "$CADDY_BIN")" = 0 ] || die "Caddy 二进制必须由 root 所有"
if runuser -u caddy -- test -w "$CADDY_BIN" || runuser -u caddy -- test -w /usr/bin; then
  die "caddy 用户可以修改二进制或安装目录，拒绝升级"
fi
if command -v dpkg-query >/dev/null && dpkg-query -S "$CADDY_BIN" >/dev/null 2>&1; then
  die "Caddy 由包管理器安装，请使用 apt 升级"
fi
if command -v rpm >/dev/null && rpm -qf "$CADDY_BIN" >/dev/null 2>&1; then
  die "Caddy 由包管理器安装，请使用 dnf / yum 升级"
fi
[ "$(systemctl show -p User --value "$SERVICE")" = caddy ] \
  || die "服务必须以 caddy 用户运行"
start="$(systemctl show -p ExecStart --value "$SERVICE")"
[[ "$start" == *"argv[]=/usr/bin/caddy run --resume --config /etc/caddy/bootstrap.Caddyfile --adapter caddyfile ;"* ]] \
  || die "服务启动命令不是标准 --resume 配置，请手动升级"
environment="$(systemctl show -p Environment --value "$SERVICE")"
[[ "$environment" != *HOME=* && "$environment" != *XDG_* ]] \
  || die "服务使用自定义 HOME/XDG 路径，请手动升级"
[ -z "$(systemctl show -p EnvironmentFiles --value "$SERVICE")" ] \
  || die "服务使用自定义环境文件，请手动升级"
systemctl is-active --quiet "$SERVICE" || die "Caddy 未运行，请先恢复服务"

as_caddy() { runuser -u caddy -- timeout 30 "$@"; }
CURRENT="$(as_caddy "$CADDY_BIN" version | awk 'NR == 1 {print $1}')" \
  || die "无法读取当前版本"
[[ "$CURRENT" =~ ^v2\.[0-9]+\.[0-9]+$ ]] \
  || die "仅自动升级稳定版 Caddy 2，当前版本：$CURRENT"
modules="$(as_caddy "$CADDY_BIN" list-modules --skip-standard)" \
  || die "无法检查 Caddy 插件"
[ -z "$modules" ] || die "检测到额外或未知插件，官方标准版会丢失插件，请手动升级"

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l) ARCH=armv7 ;;
  armv6l) ARCH=armv6 ;;
  *) die "不支持的 CPU 架构" ;;
esac
TMP="$(mktemp -d /var/tmp/caddyui-upgrade.XXXXXX)"
# caddy can read selected root-owned files but cannot change them.
chmod 0711 "$TMP"
installed=0
committed=0

atomic_install() {
  local source="$1" target="$2" staged
  staged="$(mktemp "${target}.XXXXXX")" || return 1
  if ! install -o root -g root -m 0755 "$source" "$staged" || ! mv -fT "$staged" "$target"; then
    rm -f "$staged"
    return 1
  fi
}
restore_config() {
  # The destination is inside caddy's writable home; never write it as root.
  as_caddy /bin/sh -c '
    temporary=$(mktemp "${2}.restore.XXXXXX") || exit 1
    trap '\''rm -f "$temporary"'\'' EXIT
    cat "$1" > "$temporary" && chmod 0600 "$temporary" && mv -f "$temporary" "$2"
  ' sh "$TMP/config.json" "$AUTOSAVE"
}
healthy() {
  systemctl is-active --quiet "$SERVICE" &&
    as_caddy curl -q -fsS --noproxy '*' --max-time 5 \
      --unix-socket /run/caddy/admin.sock http://localhost/config/ -o /dev/null
}
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [ "$installed" = 1 ] && [ "$committed" = 0 ]; then
    log "升级未完成，尝试恢复旧内核及升级前配置……"
    if timeout 30 systemctl stop "$SERVICE" &&
       atomic_install "$BACKUP" "$CADDY_BIN" &&
       restore_config &&
       timeout 60 systemctl restart "$SERVICE" &&
       healthy; then
      log "已恢复旧内核和配置，Caddy 与 Admin API 检查通过。请检查网站。"
    else
      log "ERROR: 自动恢复未确认成功，请立即通过 SSH 检查：journalctl -u caddy -n 50"
    fi
    status=1
  fi
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
download() {
  timeout "$(($3 + 30))" curl -q -fsSL --proto '=https' --proto-redir '=https' \
    --retry 2 --retry-max-time 330 --connect-timeout 15 --max-time "$3" \
    --max-filesize "$4" "$1" -o "$2"
}

log "当前版本：$CURRENT；正在查询官方最新稳定版……"
download "$API" "$TMP/release.json" 30 2097152 || die "查询 GitHub 失败"
TAG="$(sed -n 's/.*"tag_name" *: *"\([^"]*\)".*/\1/p' "$TMP/release.json" | head -1)"
[[ "$TAG" =~ ^v2\.[0-9]+\.[0-9]+$ ]] || die "只允许稳定版 Caddy 2，收到：$TAG"
if [ "$CURRENT" = "$TAG" ]; then
  log "已经是最新版本，无需升级。"
  exit 0
fi
[ "$(printf '%s\n%s\n' "$CURRENT" "$TAG" | sort -V | head -1)" = "$CURRENT" ] \
  || die "官方最新版本比当前版本旧，拒绝降级"
VER="${TAG#v}"
TARBALL="caddy_${VER}_linux_${ARCH}.tar.gz"
SUMS="caddy_${VER}_checksums.txt"
log "下载 $TAG 并校验 SHA-512……"
download "$DL_BASE/$TAG/$TARBALL" "$TMP/$TARBALL" 300 268435456 || die "下载二进制失败"
download "$DL_BASE/$TAG/$SUMS" "$TMP/$SUMS" 60 2097152 || die "下载校验和失败"
EXPECT="$(awk -v name="$TARBALL" '$2 == name {print $1}' "$TMP/$SUMS")"
[[ "$EXPECT" =~ ^[0-9a-fA-F]{128}$ ]] || die "校验和条目缺失、重复或格式错误"
ACTUAL="$(sha512sum "$TMP/$TARBALL" | awk '{print $1}')"
[ "${EXPECT,,}" = "$ACTUAL" ] || die "SHA-512 不匹配，拒绝安装"

# Extract to stdout: archive symlinks, modes and paths are never installed.
tar -xOzf "$TMP/$TARBALL" caddy > "$TMP/caddy" || die "解包失败"
chmod 0755 "$TMP/caddy"
NEWVER="$(as_caddy "$TMP/caddy" version | awk 'NR == 1 {print $1}')" || die "新二进制无法运行"
[ "$NEWVER" = "$TAG" ] || die "新二进制版本与下载版本不一致"

# Validate the actual resume configuration. Never provision user config as root.
as_caddy cat "$AUTOSAVE" > "$TMP/config.json" || die "无法读取 autosave.json，请先下发配置"
chown root:caddy "$TMP/config.json"
chmod 0640 "$TMP/config.json"
log "用新版本预检现有配置……"
as_caddy "$TMP/caddy" validate --config "$TMP/config.json" \
  || die "新版本不兼容现有配置，现有内核和运行服务保持不变"
as_caddy cmp -s "$AUTOSAVE" "$TMP/config.json" \
  || die "升级期间配置发生变化，请停止编辑后重试"

atomic_install "$CADDY_BIN" "$BACKUP" || die "备份旧内核失败"
install -d -o root -g root -m 0700 /var/lib/caddyui-upgrade
install -o root -g root -m 0600 "$TMP/config.json" /var/lib/caddyui-upgrade/config.json.bak \
  || die "备份配置失败"
installed=1
atomic_install "$TMP/caddy" "$CADDY_BIN" || die "安装新内核失败"
log "重启 Caddy（网站会短暂中断）……"
timeout 60 systemctl restart "$SERVICE" || die "新版本启动失败"
pid="$(systemctl show -p MainPID --value "$SERVICE")"
for attempt in 1 2 3 4 5; do
  sleep 2
  healthy || die "新版本启动检查失败"
  [ "$(systemctl show -p MainPID --value "$SERVICE")" = "$pid" ] || die "新版本发生异常重启"
done
committed=1
log "升级完成：$CURRENT → $NEWVER；Caddy 和 Admin API 检查通过，请确认网站访问正常。"
log "旧内核：$BACKUP；配置备份：/var/lib/caddyui-upgrade/config.json.bak"
