package web

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"caddyui/internal/app"
	"caddyui/internal/caddy"
	"caddyui/internal/certs"
	"caddyui/internal/store"
)

func TestSiteDeleteCertificateCleanup(t *testing.T) {
	for _, tc := range []struct {
		name, option                               string
		reject, advanced, disabledWildcard, remove bool
	}{
		{name: "default preserves certificates"},
		{name: "explicit cleanup", option: "1", remove: true},
		{name: "failed publication preserves certificates", option: "1", reject: true},
		{name: "custom config preserves certificates", option: "1", advanced: true},
		{name: "disabled wildcard preserves certificates", option: "1", disabledWildcard: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			locator := certs.New(t.TempDir())
			db, _, _ := frontendFixture(t, locator)
			site := &store.Site{Domains: "app.example.com", UpstreamScheme: "http", UpstreamHost: "127.0.0.1", UpstreamPort: 8080, HTTPS: true, Enabled: true}
			if err := db.CreateSite(site); err != nil {
				t.Fatal(err)
			}
			if tc.advanced || tc.disabledWildcard {
				other := &store.Site{Domains: "other.test", UpstreamScheme: "http", UpstreamHost: "127.0.0.1", UpstreamPort: 8081}
				if tc.advanced {
					other.Advanced = "header X-Test yes"
				}
				if tc.disabledWildcard {
					other.Domains = "*.example.com"
				}
				if err := db.CreateSite(other); err != nil {
					t.Fatal(err)
				}
			}
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			leaf := &x509.Certificate{SerialNumber: big.NewInt(1), DNSNames: site.DomainList()}
			der, err := x509.CreateCertificate(rand.Reader, leaf, leaf, &key.PublicKey, key)
			if err != nil {
				t.Fatal(err)
			}
			dir := filepath.Join(locator.CertRoot(), "issuer", site.Domains)
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			base := filepath.Join(dir, site.Domains)
			for ext, data := range map[string][]byte{".crt": pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), ".key": []byte("key"), ".json": []byte("{}")} {
				if err := os.WriteFile(base+ext, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			loads := 0
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/load" {
					loads++
					if _, err := os.Stat(base + ".key"); err != nil {
						t.Error("key removed before publication")
					}
					if tc.reject {
						http.Error(w, "rejected", http.StatusBadRequest)
						return
					}
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer api.Close()
			s := &Server{svc: &app.Service{Store: db, Certs: locator, Caddy: caddy.New(strings.TrimPrefix(api.URL, "http://"))}}
			r := httptest.NewRequest(http.MethodPost, "/sites/1/delete", strings.NewReader(url.Values{"cleanup_certs": {tc.option}}.Encode()))
			r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			r.SetPathValue("id", "1")
			s.handleSiteDelete(httptest.NewRecorder(), r)
			if loads != 1 {
				t.Fatalf("loads = %d", loads)
			}
			if _, err := db.SiteByID(site.ID); !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("site not deleted: %v", err)
			}
			for _, ext := range []string{".crt", ".key", ".json"} {
				_, err := os.Stat(base + ext)
				if tc.remove && !os.IsNotExist(err) || !tc.remove && err != nil {
					t.Fatalf("file %s: %v", ext, err)
				}
			}
			versions, err := db.ConfigVersions(10)
			if err != nil || len(versions) != 1 {
				t.Fatalf("history missing: %v", err)
			}
		})
	}
}
