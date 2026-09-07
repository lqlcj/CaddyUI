#!/usr/bin/env bash
# Isolated systemd integration test. The fake helper never touches Caddy.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run this test as root'; exit 1; }
source_dir="$(cd "$(dirname "$0")" && pwd)"
temporary="$(mktemp -d /var/tmp/caddyui-upgrade-test.XXXXXX)"
name="caddyui-upgrade-test-$$"
cleanup() {
  systemctl stop "$name.socket" "$name@*.service" >/dev/null 2>&1 || true
  rm -f "/run/systemd/system/$name.socket" "/run/systemd/system/$name@.service"
  systemctl daemon-reload
  rm -rf "$temporary"
}
trap cleanup EXIT
chmod 0755 "$temporary"
printf '#!/bin/sh\nid -u\n' > "$temporary/helper"
chmod 0755 "$temporary/helper"
sed "s|/usr/local/lib/caddyui/upgrade-caddy.sh|$temporary/helper|g" \
  "$source_dir/upgrade-request.sh" > "$temporary/request.sh"
sed -e "s|/run/caddyui-upgrade.sock|$temporary/upgrade.sock|" \
  -e 's/SocketUser=root/SocketUser=nobody/' \
  -e 's/SocketGroup=caddy/SocketGroup=nogroup/' \
  -e 's/SocketMode=0660/SocketMode=0600/' \
  "$source_dir/caddyui-upgrade.socket" > "/run/systemd/system/$name.socket"
sed "s|/usr/local/lib/caddyui/upgrade-request.sh|$temporary/request.sh|" \
  "$source_dir/caddyui-upgrade@.service" > "/run/systemd/system/$name@.service"
chmod 0644 "/run/systemd/system/$name.socket" "/run/systemd/system/$name@.service"
systemd-analyze verify "/run/systemd/system/$name.socket" "/run/systemd/system/$name@.service"
systemctl daemon-reload
systemctl start "$name.socket"

# The caller has the panel's restrictions; the helper must still run as root.
systemd-run --quiet --wait --pipe -p User=nobody -p NoNewPrivileges=true -p ProtectSystem=full \
  python3 -c '
import socket, sys
def request(command):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(10)
        client.connect(sys.argv[1])
        client.sendall(command.encode() + b"\n")
        result = b""
        while True:
            chunk = client.recv(4096)
            if not chunk: return result
            result += chunk
assert request("CHECK") == b"READY\n"
assert request("UPGRADE") == b"0\n\nCADDYUI-UPGRADE-EXIT 0\n"
assert request("UPGRADE /tmp/x") == b""
print("PASS: sandboxed caller, privileged helper, fixed commands")
' "$temporary/upgrade.sock"

systemd-run --quiet --wait --pipe -p User=daemon python3 -c '
import socket, sys
with socket.socket(socket.AF_UNIX) as client:
    try: client.connect(sys.argv[1])
    except PermissionError: print("PASS: unauthorized user rejected")
    else: raise AssertionError("unauthorized socket access")
' "$temporary/upgrade.sock"
