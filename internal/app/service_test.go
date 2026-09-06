package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"caddyui/internal/caddy"
	"caddyui/internal/store"
)

// fakeCaddy 模拟 Caddy Admin API：GET /config/ 返回指定形态的当前配置，
// POST /load 计数并返回 200。
func fakeCaddy(t *testing.T, withServers bool, loads *int) *httptest.Server {
	t.Helper()

	config := `{"apps":{}}`
	if withServers {
		config = `{"apps":{"http":{"servers":{"srv0":{}}}}}`
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/config/":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(config))
		case "/load":
			if loads != nil {
				*loads++
			}
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "caddyui.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// 空库 + Caddy 正在跑真实站点：启动同步必须被拦下，绝不能下发空配置。
func TestSyncSkipsEmptyDBWhenCaddyIsServing(t *testing.T) {
	var loads int
	ts := fakeCaddy(t, true, &loads)

	db := openTestStore(t)
	svc := &Service{
		Store: db,
		Caddy: caddy.New(strings.TrimPrefix(ts.URL, "http://")),
	}

	err := svc.Sync()
	if !errors.Is(err, ErrSyncSkippedEmptyDB) {
		t.Fatalf("Sync() error = %v, want ErrSyncSkippedEmptyDB", err)
	}
	if loads != 0 {
		t.Fatalf("Sync() made %d /load requests, want 0 (must not wipe running sites)", loads)
	}
}

// 空库 + Caddy 本来就没跑任何站点：正常下发一次空配置（首次初始化场景）。
func TestSyncProceedsWhenEmptyDBAndCaddyIdle(t *testing.T) {
	var loads int
	ts := fakeCaddy(t, false, &loads)

	db := openTestStore(t)
	svc := &Service{
		Store: db,
		Caddy: caddy.New(strings.TrimPrefix(ts.URL, "http://")),
	}

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync() error = %v, want nil", err)
	}
	if loads != 1 {
		t.Fatalf("Sync() made %d /load requests, want 1", loads)
	}
}

// 库里明明有站点时，即使 Caddy 正在跑，也按库里内容正常下发（数据库是权威源）。
func TestSyncOverwritesWhenDBHasSites(t *testing.T) {
	var loads int
	ts := fakeCaddy(t, true, &loads)

	db := openTestStore(t)
	if err := db.CreateSite(&store.Site{
		Domains:        "example.com",
		UpstreamScheme: "http",
		UpstreamHost:   "127.0.0.1",
		UpstreamPort:   8080,
		Enabled:        true,
		HTTPS:          true,
		ForceHTTPS:     true,
	}); err != nil {
		t.Fatal(err)
	}

	svc := &Service{
		Store: db,
		Caddy: caddy.New(strings.TrimPrefix(ts.URL, "http://")),
	}

	if err := svc.Sync(); err != nil {
		t.Fatalf("Sync() error = %v, want nil", err)
	}
	if loads != 1 {
		t.Fatalf("Sync() made %d /load requests, want 1", loads)
	}
}
