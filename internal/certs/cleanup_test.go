package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

func writeBundle(t *testing.T, locator *Locator, issuer, domain string, names []string) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(1), DNSNames: names}
	der, err := x509.CreateCertificate(rand.Reader, leaf, leaf, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(locator.CertRoot(), issuer, storageSubject(domain))
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(dir, storageSubject(domain))
	for ext, data := range map[string][]byte{
		".crt": pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		".key": []byte("private key"), ".json": []byte(`{"sans":[]}`),
	} {
		if err := os.WriteFile(base+ext, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return base
}

func TestCleanupCertificateOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, domain              string
		names, deleted, remaining []string
		remove                    bool
	}{
		{"exclusive", "app.example.com", []string{"app.example.com"}, []string{"app.example.com"}, nil, true},
		{"shared SAN", "app.example.com", []string{"app.example.com", "api.example.com"}, []string{"app.example.com"}, nil, false},
		{"owned SANs", "app.example.com", []string{"app.example.com", "api.example.com"}, []string{"app.example.com", "api.example.com"}, nil, true},
		{"shared wildcard", "*.example.com", []string{"*.example.com"}, []string{"*.example.com"}, []string{"api.example.com"}, false},
		{"remaining wildcard", "app.example.com", []string{"app.example.com"}, []string{"app.example.com"}, []string{"*.example.com"}, false},
		{"exclusive wildcard", "*.example.com", []string{"*.example.com"}, []string{"*.example.com"}, nil, true},
		{"same domain", "app.example.com", []string{"app.example.com"}, []string{"app.example.com"}, []string{"app.example.com"}, false},
		{"wrong identity", "app.example.com", []string{"other.example.com"}, []string{"app.example.com"}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			locator := New(t.TempDir())
			var bases []string
			for _, issuer := range []string{"issuer-a", "issuer-b"} {
				bases = append(bases, writeBundle(t, locator, issuer, tc.domain, tc.names))
			}
			unrelated := writeBundle(t, locator, "issuer-a", "unrelated.test", []string{"unrelated.test"})
			result, err := locator.Cleanup(tc.deleted, tc.remaining)
			if err != nil {
				t.Fatal(err)
			}
			if tc.remove && result.Removed != 2 || !tc.remove && result.Kept != 2 {
				t.Fatalf("unexpected result: %+v", result)
			}
			for _, base := range bases {
				for _, ext := range []string{".crt", ".key", ".json"} {
					_, err := os.Stat(base + ext)
					if tc.remove && !os.IsNotExist(err) || !tc.remove && err != nil {
						t.Fatalf("unexpected file state %s: %v", base+ext, err)
					}
				}
			}
			if _, err := os.Stat(unrelated + ".key"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCleanupPreservesUnknownFilesAndInvalidCertificates(t *testing.T) {
	locator := New(t.TempDir())
	base := writeBundle(t, locator, "issuer", "app.example.com", []string{"app.example.com"})
	if err := os.WriteFile(base+".crt", []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := locator.Cleanup([]string{"app.example.com", "../../outside"}, nil)
	if err != nil || result.Removed != 0 || result.Kept != 2 {
		t.Fatalf("%+v %v", result, err)
	}
	if _, err := os.Stat(base + ".key"); err != nil {
		t.Fatal(err)
	}
	base = writeBundle(t, locator, "issuer", "app.example.com", []string{"app.example.com"})
	if err := os.WriteFile(base+".notes", []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err = locator.Cleanup([]string{"app.example.com"}, nil)
	if err != nil || result.Removed != 1 {
		t.Fatalf("%+v %v", result, err)
	}
	if _, err := os.Stat(base + ".notes"); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupDoesNotFollowSubjectSymlink(t *testing.T) {
	locator := New(t.TempDir())
	outside := t.TempDir()
	issuer := filepath.Join(locator.CertRoot(), "issuer")
	if err := os.MkdirAll(issuer, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(issuer, "app.example.com")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	result, err := locator.Cleanup([]string{"app.example.com"}, nil)
	if err != nil || result.Kept != 1 || result.Removed != 0 {
		t.Fatalf("%+v %v", result, err)
	}
}
