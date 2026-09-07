package web

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"caddyui/internal/app"
	"caddyui/internal/caddy"
	"caddyui/internal/certs"
	"caddyui/internal/store"
)

func frontendFixture(t *testing.T, locators ...*certs.Locator) (*store.Store, http.Handler, *store.Session) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"apps":{}}`))
	}))
	t.Cleanup(api.Close)
	svc := &app.Service{Store: db, Caddy: caddy.New(strings.TrimPrefix(api.URL, "http://"))}
	if len(locators) > 0 {
		svc.Certs = locators[0]
	}
	handler, err := New(svc, fstest.MapFS{
		"dist/index.html":    {Data: []byte(`<html class="{{.Theme}}"><div id="root"></div><script type="module" src="/assets/app.js"></script></html>`)},
		"dist/assets/app.js": {Data: []byte("export {}")},
	}, "test")
	if err != nil {
		t.Fatal(err)
	}
	user, err := db.CreateUser("admin@example.com", "TestPassword123!")
	if err != nil {
		t.Fatal(err)
	}
	session, err := db.CreateSession(user.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return db, handler, session
}

func TestSiteCertificatePathsAfterIssuance(t *testing.T) {
	locator := certs.New(t.TempDir())
	db, handler, session := frontendFixture(t, locator)
	site := &store.Site{Domains: "app.example.com", UpstreamScheme: "http", UpstreamHost: "127.0.0.1", UpstreamPort: 8080, Enabled: true, HTTPS: true}
	if err := db.CreateSite(site); err != nil {
		t.Fatal(err)
	}
	endpoint := "/sites/1/certificates"
	unauthorized := frontendRequest(handler, nil, http.MethodGet, endpoint, nil, "")
	if !strings.Contains(unauthorized.Body.String(), `"redirect":"/login"`) {
		t.Fatal("certificate paths require authentication")
	}
	before := frontendRequest(handler, session, http.MethodGet, endpoint, nil, "")
	var pending siteCertificateData
	if err := json.Unmarshal(before.Body.Bytes(), &pending); err != nil {
		t.Fatal(err)
	}
	if pending.CertAvailable || len(pending.Certs) != 1 || pending.Certs[0].Found {
		t.Fatalf("unexpected pending state: %+v", pending)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "CaddyUI test"}, DNSNames: []string{"app.example.com"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(30 * 24 * time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(locator.CertRoot(), "test-issuer", "app.example.com")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	crtPath, keyPath := filepath.Join(dir, "app.example.com.crt"), filepath.Join(dir, "app.example.com.key")
	if err := os.WriteFile(crtPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, []byte("private-key-must-not-be-returned"), 0600); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{endpoint, "/sites/1/edit"} {
		response := frontendRequest(handler, session, http.MethodGet, path, nil, "")
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid certificate response: %d", response.Code)
		}
		var got siteCertificateData
		if path == endpoint {
			err = json.Unmarshal(response.Body.Bytes(), &got)
		} else {
			var page struct{ Data siteCertificateData }
			err = json.Unmarshal(response.Body.Bytes(), &page)
			got = page.Data
		}
		if err != nil {
			t.Fatal(err)
		}
		if !got.CertAvailable || len(got.Certs) != 1 {
			t.Fatalf("missing certificates: %+v", got)
		}
		cert := got.Certs[0]
		if !cert.Found || !cert.Parsed || cert.CertPath != crtPath || cert.KeyPath != keyPath || cert.Issuer != "CaddyUI test" {
			t.Fatalf("unexpected certificate: %+v", cert)
		}
		if strings.Contains(response.Body.String(), "private-key-must-not-be-returned") || strings.Contains(response.Body.String(), "BEGIN CERTIFICATE") {
			t.Fatal("certificate contents leaked")
		}
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	response := frontendRequest(handler, session, http.MethodGet, endpoint, nil, "")
	var withoutKey siteCertificateData
	if err := json.Unmarshal(response.Body.Bytes(), &withoutKey); err != nil {
		t.Fatal(err)
	}
	if withoutKey.Certs[0].KeyPath != "" {
		t.Fatal("missing key must not have a copyable path")
	}
}

func frontendRequest(handler http.Handler, session *store.Session, method, path string, values url.Values, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(values.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if session != nil {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session.Token})
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestFrontendPagesAndAuthentication(t *testing.T) {
	db, handler, session := frontendFixture(t)
	site := &store.Site{Domains: "app.example.com", UpstreamScheme: "http", UpstreamHost: "127.0.0.1", UpstreamPort: 8080, Enabled: true, HTTPS: true, BasicUser: "user", BasicHash: "private-password-hash"}
	if err := db.CreateSite(site); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/sites", "/sites/new", "/sites/1/edit", "/config", "/settings"} {
		t.Run(path, func(t *testing.T) {
			anonymous := frontendRequest(handler, nil, http.MethodGet, path, nil, "")
			if !strings.Contains(anonymous.Body.String(), `"redirect":"/login"`) {
				t.Fatalf("unauthenticated response: %s", anonymous.Body)
			}
			response := frontendRequest(handler, session, http.MethodGet, path, nil, "")
			if response.Code != http.StatusOK || !json.Valid(response.Body.Bytes()) {
				t.Fatalf("invalid page: %d %s", response.Code, response.Body)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("session data must not be cached")
			}
		})
	}
	response := frontendRequest(handler, session, http.MethodGet, "/sites", nil, "")
	body := response.Body.String()
	for _, want := range []string{`"EnabledCount":1`, `"HTTPSCount":1`, `"HasBasicAuth":true`, `"UpstreamURL":"http://127.0.0.1:8080"`, session.CSRF} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in %s", want, body)
		}
	}
	if strings.Contains(body, "private-password-hash") || strings.Contains(body, "BasicHash") {
		t.Fatal("site password hash leaked")
	}
}

func TestFrontendMutationsPreserveCSRFAndOriginChecks(t *testing.T) {
	_, handler, session := frontendFixture(t)
	for _, tc := range []struct {
		name, csrf, origin string
		code               int
	}{
		{"missing CSRF", "", "", http.StatusForbidden},
		{"wrong CSRF", "wrong", "", http.StatusForbidden},
		{"foreign origin", session.CSRF, "https://other.example", http.StatusForbidden},
		{"valid request", session.CSRF, "http://example.com", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := frontendRequest(handler, session, http.MethodPost, "/settings/acme", url.Values{"csrf": {tc.csrf}, "acme_ca": {""}}, tc.origin)
			if response.Code != tc.code {
				t.Fatalf("got %d, want %d: %s", response.Code, tc.code, response.Body)
			}
			if tc.code == http.StatusOK && !strings.Contains(response.Body.String(), `"redirect":"/settings"`) {
				t.Fatal("mutation did not return navigation result")
			}
		})
	}
}

func TestFrontendShellPreservesFlashForDataRequest(t *testing.T) {
	_, handler, session := frontendFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/sites", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session.Token})
	req.AddCookie(&http.Cookie{Name: themeCookie, Value: themeLight})
	req.AddCookie(&http.Cookie{Name: flashCookie, Value: encodeFlash("ok", "saved")})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if !strings.Contains(w.Body.String(), `class="light"`) || !strings.Contains(w.Body.String(), `id="root"`) {
		t.Fatalf("invalid React shell: %s", w.Body)
	}
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == flashCookie {
			t.Fatal("shell consumed the flash before React could fetch it")
		}
	}
	req.Header.Set("Accept", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if !strings.Contains(w.Body.String(), `"Message":"saved"`) {
		t.Fatal("flash missing from page data")
	}
}

func TestFrontendLoginFailureAndLogout(t *testing.T) {
	_, handler, session := frontendFixture(t)
	response := frontendRequest(handler, nil, http.MethodPost, "/login", url.Values{"username": {"admin@example.com"}, "password": {"invalid"}}, "")
	if !strings.Contains(response.Body.String(), `"Error":`) || !strings.Contains(response.Body.String(), `"page":"login"`) {
		t.Fatalf("invalid credentials response: %s", response.Body)
	}
	response = frontendRequest(handler, session, http.MethodPost, "/logout", url.Values{"csrf": {session.CSRF}}, "")
	if !strings.Contains(response.Body.String(), `"redirect":"/login"`) {
		t.Fatal("logout failed")
	}
	response = frontendRequest(handler, session, http.MethodGet, "/sites", nil, "")
	if !strings.Contains(response.Body.String(), `"redirect":"/login"`) {
		t.Fatal("session remained valid after logout")
	}
}

func TestMissingFrontendBuildIsReported(t *testing.T) {
	_, err := New(nil, fstest.MapFS{}, "test")
	if err == nil || !strings.Contains(err.Error(), "npm") {
		t.Fatalf("expected actionable build error, got %v", err)
	}
}
