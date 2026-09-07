package caddy

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"caddyui/internal/store"
)

// Run against the official binary without starting listeners or requesting certificates.
func TestOfficialCaddyConfiguration(t *testing.T) {
	binary := os.Getenv("CADDY_TEST_BINARY")
	if binary == "" {
		t.Skip("set CADDY_TEST_BINARY to run official Caddy validation")
	}
	hash, err := store.HashPassword("TestPassword123!")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                                string
		https, force, upstreamTLS, insecure bool
		basicUser, advanced                 string
	}{
		{name: "http"},
		{name: "automatic_https", https: true, force: true},
		{name: "http_and_https", https: true},
		{name: "https_upstream", https: true, force: true, upstreamTLS: true},
		{name: "self_signed_upstream", upstreamTLS: true, insecure: true},
		{name: "basic_auth", basicUser: "viewer"},
		{name: "quoted_auth_username", basicUser: "#viewer"},
		{name: "advanced", advanced: "encode gzip\nheader X-Frame-Options SAMEORIGIN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			site := &store.Site{Domains: "app.example.com,www.example.com", UpstreamScheme: "http", UpstreamHost: "::1", UpstreamPort: 8080, Enabled: true, HTTPS: tc.https, ForceHTTPS: tc.force, SkipTLSVerify: tc.insecure, Advanced: tc.advanced}
			if tc.upstreamTLS {
				site.UpstreamScheme = "https"
			}
			if tc.basicUser != "" {
				site.BasicUser, site.BasicHash = tc.basicUser, hash
			}
			if err := site.Validate(); err != nil {
				t.Fatal(err)
			}
			raw := Render(RenderOptions{AdminAddr: "127.0.0.1:2019", ACMEEmail: "admin@example.com", ACMECA: "https://acme-staging-v02.api.letsencrypt.org/directory", Sites: []*store.Site{site}})
			config := filepath.Join(t.TempDir(), "Caddyfile")
			if err := os.WriteFile(config, raw, 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, "adapt", "--config", config, "--adapter", "caddyfile", "--validate")
			cmd.Env = append(os.Environ(), "XDG_DATA_HOME="+t.TempDir(), "XDG_CONFIG_HOME="+t.TempDir())
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			out, err := cmd.Output()
			if err != nil {
				t.Fatalf("official Caddy rejected config: %v\n%s\n%s", err, stderr.String(), raw)
			}
			var decoded any
			if err := json.Unmarshal(out, &decoded); err != nil {
				t.Fatal(err)
			}
			if tc.basicUser != "" {
				encoded, _ := json.Marshal(decoded)
				want, _ := json.Marshal(tc.basicUser)
				if !bytes.Contains(encoded, append([]byte(`"username":`), want...)) {
					t.Fatalf("authentication user missing: %s", encoded)
				}
			}
			if strings.Contains(stderr.String(), "deprecated") {
				t.Fatalf("deprecated configuration: %s", stderr.String())
			}
		})
	}
	for _, addr := range []string{"127.0.0.1:2019", "unix//run/caddy/admin.sock"} {
		raw := Render(RenderOptions{AdminAddr: addr})
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		cmd := exec.CommandContext(ctx, binary, "adapt", "--config", "-", "--adapter", "caddyfile")
		cmd.Stdin = bytes.NewReader(raw)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("bootstrap %s: %v\n%s", addr, err, out)
		}
	}
}
