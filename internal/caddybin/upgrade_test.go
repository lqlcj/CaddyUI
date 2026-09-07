package caddybin

import (
	"bufio"
	"io"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUpgradeProtocol(t *testing.T) {
	for _, tc := range []struct {
		name, command, response string
		wantErr                 bool
	}{
		{"available", "CHECK", "READY\n", false},
		{"not ready", "CHECK", "ERROR\n", true},
		{"success", "UPGRADE", "installed\nCADDYUI-UPGRADE-EXIT 0\n", false},
		{"failed", "UPGRADE", "ERROR: download failed\nCADDYUI-UPGRADE-EXIT 1\n", true},
		{"interrupted", "UPGRADE", "installing\n", true},
		{"oversized", "UPGRADE", strings.Repeat("x", 128*1024+1), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			socket := filepath.Join(t.TempDir(), "upgrade.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				defer conn.Close()
				line, _ := bufio.NewReader(conn).ReadString('\n')
				if line != tc.command+"\n" {
					t.Errorf("unexpected request %q", line)
				}
				_, _ = io.WriteString(conn, tc.response)
			}()
			_, err = helperRequest(socket, tc.command, time.Second)
			<-done
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, want error %v", err, tc.wantErr)
			}
		})
	}
}

func TestUpgradeUnavailableAndInvalidCommand(t *testing.T) {
	for _, command := range []string{"CHECK", "UPGRADE", "UPGRADE /tmp/other"} {
		if _, err := helperRequest(filepath.Join(t.TempDir(), "missing.sock"), command, time.Second); err == nil {
			t.Fatalf("command %q should fail", command)
		}
	}
}
