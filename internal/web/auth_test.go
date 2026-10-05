package web

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"caddyui/internal/app"
	"caddyui/internal/store"
)

func TestSetupRequiresSecretAndCannotReopen(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	const secret = "test-only-setup-secret-never-returned"
	svc := &app.Service{Store: db, SetupToken: secret}
	handler, err := New(svc, fstest.MapFS{"dist/index.html": {Data: []byte("<div id='root'></div>")}}, "test")
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"", "wrong", secret} {
		response := frontendRequest(handler, nil, http.MethodPost, "/setup", url.Values{
			"username": {"owner@example.com"}, "password": {"Password123!"},
			"confirm": {"Password123!"}, "setup_token": {token},
		}, "")
		if strings.Contains(response.Body.String(), secret) {
			t.Fatal("setup secret leaked in response")
		}
		if token != secret {
			if response.Code != http.StatusForbidden || db.UserCount() != 0 {
				t.Fatalf("invalid token accepted: %d %s", response.Code, response.Body)
			}
		} else if db.UserCount() != 1 {
			t.Fatalf("valid setup failed: %s", response.Body)
		}
	}
	response := frontendRequest(handler, nil, http.MethodPost, "/setup", url.Values{
		"username": {"attacker@example.com"}, "password": {"Password123!"},
		"confirm": {"Password123!"}, "setup_token": {secret},
	}, "")
	if db.UserCount() != 1 || !strings.Contains(response.Body.String(), "/login") {
		t.Fatal("registration reopened after setup")
	}
}

func TestOriginAndProxyTrust(t *testing.T) {
	for _, tc := range []struct {
		name, remote, proto, origin, fetch, xff, wantIP string
		tls, originOK, secure                           bool
	}{
		{name: "direct", remote: "192.0.2.1:1234", origin: "http://panel.example", originOK: true, wantIP: "192.0.2.1"},
		{name: "forged proxy", remote: "192.0.2.1:1234", proto: "https", origin: "https://panel.example", xff: "10.0.0.1", wantIP: "192.0.2.1"},
		{name: "trusted proxy", remote: "127.0.0.1:1234", proto: "https", origin: "https://panel.example", xff: "fake, 192.0.2.2", wantIP: "192.0.2.2", originOK: true, secure: true},
		{name: "invalid forwarded IP", remote: "[::1]:1234", xff: "fake", wantIP: "::1", originOK: true},
		{name: "wrong scheme", remote: "192.0.2.1:1234", tls: true, origin: "http://panel.example", wantIP: "192.0.2.1", secure: true},
		{name: "cross site without origin", remote: "192.0.2.1:1234", fetch: "cross-site", wantIP: "192.0.2.1"},
		{name: "null origin", remote: "192.0.2.1:1234", origin: "null", wantIP: "192.0.2.1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "http://panel.example/login", nil)
			r.RemoteAddr = tc.remote
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("X-Forwarded-Proto", tc.proto)
			r.Header.Set("X-Forwarded-For", tc.xff)
			r.Header.Set("Sec-Fetch-Site", tc.fetch)
			if tc.tls {
				r.TLS = &tls.ConnectionState{}
			}
			if checkOrigin(r) != tc.originOK || secureRequest(r) != tc.secure || clientIP(r) != tc.wantIP {
				t.Fatalf("origin=%v secure=%v IP=%s", checkOrigin(r), secureRequest(r), clientIP(r))
			}
			w := httptest.NewRecorder()
			setSessionCookie(w, r, "test", time.Now().Add(time.Hour))
			if w.Result().Cookies()[0].Secure != tc.secure {
				t.Fatal("wrong Secure cookie flag")
			}
		})
	}
}

func TestAllMutationsRejectMissingCSRFAndForeignOrigins(t *testing.T) {
	_, handler, session := frontendFixture(t)
	for _, path := range []string{
		"/logout", "/sites/new", "/sites/1/edit", "/sites/1/toggle", "/sites/1/delete",
		"/config/apply", "/config/rollback/1", "/settings/acme", "/settings/password",
		"/settings/caddy/check", "/settings/caddy/upgrade",
	} {
		for _, csrf := range []string{"", session.CSRF} {
			origin := ""
			if csrf != "" {
				origin = "https://evil.example"
			}
			response := frontendRequest(handler, session, http.MethodPost, path, url.Values{"csrf": {csrf}}, origin)
			if response.Code != http.StatusForbidden {
				t.Fatalf("%s accepted untrusted mutation: %d", path, response.Code)
			}
		}
		response := frontendRequest(handler, nil, http.MethodPost, path, nil, "")
		if !strings.Contains(response.Body.String(), "/login") {
			t.Fatalf("%s does not require login: %s", path, response.Body)
		}
	}
}

func TestLimiterIsBounded(t *testing.T) {
	l := newLimiter()
	for i := 0; i < 4096; i++ {
		l.hits[string(rune(i))] = []time.Time{time.Now()}
	}
	if l.allow("new-address", 10, time.Minute) || len(l.hits) != 4096 {
		t.Fatal("limiter grew past limit")
	}
	l.hits[string(rune(0))] = []time.Time{time.Now().Add(-time.Hour)}
	if !l.allow("replacement", 10, time.Minute) {
		t.Fatal("expired limiter entries did not recover")
	}
}
