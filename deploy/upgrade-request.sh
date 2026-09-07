#!/usr/bin/env bash
set -euo pipefail

# Socket ownership authorizes callers; only these two literal commands exist.
request=""
IFS= read -r -t 5 -n 16 request || exit 1
case "$request" in
  CHECK)
    test -x /usr/local/lib/caddyui/upgrade-caddy.sh
    command -v flock >/dev/null
    printf 'READY\n'
    ;;
  UPGRADE)
    # Capture output independently of the client, so a panel restart cannot
    # interrupt binary replacement or recovery through a broken socket.
    output="$(mktemp /var/tmp/caddyui-upgrade-output.XXXXXX)"
    trap 'rm -f "$output"' EXIT
    status=0
    /usr/local/lib/caddyui/upgrade-caddy.sh </dev/null >"$output" 2>&1 || status=$?
    tail -c 65536 "$output"
    printf '\nCADDYUI-UPGRADE-EXIT %d\n' "$status"
    ;;
  *) exit 1 ;;
esac
