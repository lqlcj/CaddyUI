#!/usr/bin/env python3
"""Linux/root only: real helper in a disposable chroot; no host services/network."""
import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest

class UpgradeTests(unittest.TestCase):
    def setUp(self):
        if os.geteuid() != 0:
            self.skipTest("requires root for disposable chroot")
        temporary = tempfile.TemporaryDirectory(prefix="caddyui-helper-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for directory in ("usr/bin", "bin", "etc", "dev", "run", "var/tmp",
                          "var/lib/caddy/.config/caddy", "fixtures"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for command in ("bash", "id", "timeout", "flock", "stat", "mktemp", "chmod",
                        "chown", "install", "mv", "rm", "cat", "cmp", "tar",
                        "sha512sum", "awk", "sed", "head", "sort", "gzip"):
            source = shutil.which(command)
            self.assertIsNotNone(source, command)
            shutil.copy2(source, self.root / "usr/bin" / command)
            deps = subprocess.run(["ldd", source], capture_output=True, text=True).stdout
            for path in re.findall(r"(/[^\s()]+)", deps):
                target = self.root / path.lstrip("/")
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, target)
        (self.root / "bin/bash").symlink_to("/usr/bin/bash")
        (self.root / "bin/sh").symlink_to("/usr/bin/bash")
        self.write("etc/passwd", "root:x:0:0::/root:/bin/sh\ncaddy:x:999:999::/var/lib/caddy:/bin/sh\n")
        self.write("etc/group", "root:x:0:\ncaddy:x:999:\n")
        self.write("dev/null", "")
        self.write("mode", "ok")
        self.write("tag", "v2.11.7")
        self.config = '{"apps":{"http":{"servers":{}}}}\n'
        self.write("var/lib/caddy/.config/caddy/autosave.json", self.config)
        self.binary = self.caddy("v2.11.6")
        self.script("caddy", self.binary)
        self.script("runuser", r'''
[ "$1" = -u ] && [ "$2" = caddy ] && [ "$3" = -- ] || exit 98
shift 3
if [ "$1" = test ]; then
  [ "$(cat /mode)" = writable ] && exit 0
  exit 1
fi
export CADDY_TEST_USER=caddy
exec "$@"
''')
        self.script("uname", "echo x86_64\n")
        self.script("sleep", "exit 0\n")
        # rpm prints an error on stdout even when a file is NOT package-owned.
        self.script("rpm", "echo 'not owned'\n[ \"$(cat /mode)\" = package ]\n")
        self.script("systemctl", r'''
mode=$(cat /mode)
case "$1" in
  show)
    case "$3" in
      User) echo caddy ;;
      ExecStart) echo '{ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --resume --config /etc/caddy/bootstrap.Caddyfile --adapter caddyfile ; ignore_errors=no ; }' ;;
      MainPID) echo 123 ;;
      Environment|EnvironmentFiles) ;;
      *) exit 97 ;;
    esac ;;
  restart)
    echo restart >> /actions
    current=$(CADDY_TEST_USER=caddy /usr/bin/caddy version)
    if [[ "$current" = v2.11.7* ]]; then
      echo '{"changed_by_new_version":true}' > /var/lib/caddy/.config/caddy/autosave.json
      [ "$mode" != restart-fails ] && [ "$mode" != recovery-fails ]
    else
      [ "$mode" != recovery-fails ]
    fi ;;
  stop) echo stop >> /actions ;;
  is-active) exit 0 ;;
  *) exit 97 ;;
esac
''')
        self.script("curl", r'''
output= url= socket=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift ;;
    --unix-socket) socket=1; shift ;;
    https://*) url=$1 ;;
  esac
  shift
done
if [ "$socket" = 1 ]; then
  [ "$CADDY_TEST_USER" = caddy ] || exit 99
  if [ "$(cat /mode)" = health-fails ] && [[ "$(CADDY_TEST_USER=caddy /usr/bin/caddy version)" = v2.11.7* ]]; then exit 7; fi
  exit 0
fi
case "$url" in
  */releases/latest) printf '{"tag_name":"%s"}\n' "$(cat /tag)" > "$output" ;;
  *_checksums.txt) cat /fixtures/checksums > "$output" ;;
  *.tar.gz) cat /fixtures/archive.tar.gz > "$output" ;;
  *) exit 96 ;;
esac
''')
        self.write("upgrade.sh", Path(__file__).with_name("upgrade-caddy.sh").read_text())
        self.archive()

    def write(self, path, content):
        (self.root / path).write_text(content)

    def script(self, name, content):
        self.write("usr/bin/" + name, "#!/bin/bash\nset -eu\n" + content)
        (self.root / "usr/bin" / name).chmod(0o755)

    def caddy(self, version):
        return r'''
[ "$CADDY_TEST_USER" = caddy ] || { echo 'CADDY EXECUTED AS ROOT'; exit 99; }
case "$1" in
  version) echo VERSION ;;
  list-modules) if [ "$(cat /mode)" = plugins ]; then echo dns.providers.example; fi ;;
  validate)
    [ "$2" = --config ] && [ -s "$3" ] || exit 98
    [ "$(cat /mode)" != invalid-config ] ;;
  *) exit 97 ;;
esac
'''.replace("VERSION", version)

    def archive(self, version="v2.11.7"):
        data = ("#!/bin/bash\nset -eu\n" + self.caddy(version)).encode()
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            entry = tarfile.TarInfo("caddy")
            entry.size = len(data)
            entry.mode = 0o755
            archive.addfile(entry, io.BytesIO(data))
        raw = buffer.getvalue()
        (self.root / "fixtures/archive.tar.gz").write_bytes(raw)
        self.write("fixtures/checksums", hashlib.sha512(raw).hexdigest() + "  caddy_2.11.7_linux_amd64.tar.gz\n")

    def run_upgrade(self):
        result = subprocess.run(["chroot", str(self.root), "/bin/bash", "/upgrade.sh"],
                                capture_output=True, text=True, timeout=20)
        self.assertNotIn("CADDY EXECUTED AS ROOT", result.stdout + result.stderr)
        return result

    def assert_original(self):
        self.assertEqual((self.root / "usr/bin/caddy").read_text(), "#!/bin/bash\nset -eu\n" + self.binary)
        self.assertEqual((self.root / "var/lib/caddy/.config/caddy/autosave.json").read_text(), self.config)

    def test_success(self):
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("升级完成", result.stdout)
        self.assertEqual((self.root / "usr/bin/caddy.bak").read_text(), "#!/bin/bash\nset -eu\n" + self.binary)
        self.assertEqual((self.root / "var/lib/caddyui-upgrade/config.json.bak").read_text(), self.config)

    def test_guards(self):
        for mode, message in (("plugins", "额外或未知插件"), ("package", "包管理器"),
                              ("writable", "可以修改二进制"), ("invalid-config", "不兼容现有配置")):
            with self.subTest(mode=mode):
                self.write("mode", mode)
                result = self.run_upgrade()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(message, result.stdout + result.stderr)
                self.assert_original()
                self.assertFalse((self.root / "actions").exists())

    def test_checksum_mismatch(self):
        self.write("fixtures/checksums", "0" * 128 + "  caddy_2.11.7_linux_amd64.tar.gz\n")
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assert_original()

    def test_wrong_binary_version(self):
        self.archive("v2.11.8")
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assert_original()

    def test_version_guards(self):
        for tag in ("v2.10.0", "v3.0.0", "v2.12.0-beta.1", "../../untrusted"):
            with self.subTest(tag=tag):
                self.write("tag", tag)
                self.assertNotEqual(self.run_upgrade().returncode, 0)
                self.assert_original()
                self.assertFalse((self.root / "actions").exists())

    def test_same_version(self):
        self.write("tag", "v2.11.6")
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_original()
        self.assertFalse((self.root / "actions").exists())

    def test_restart_failure_recovers(self):
        self.write("mode", "restart-fails")
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("已恢复旧内核和配置", result.stdout, result.stdout + result.stderr)
        self.assert_original()

    def test_health_failure_recovers(self):
        self.write("mode", "health-fails")
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("已恢复旧内核和配置", result.stdout, result.stdout + result.stderr)
        self.assert_original()

    def test_failed_recovery_is_reported(self):
        self.write("mode", "recovery-fails")
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("自动恢复未确认成功", result.stdout, result.stdout + result.stderr)
        self.assertNotIn("已恢复旧内核和配置", result.stdout)

if __name__ == "__main__":
    unittest.main(verbosity=2)
