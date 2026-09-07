// Package web 是面板的 HTTP 层：路由、模板渲染、会话与 CSRF。
package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"sync"

	"caddyui/internal/app"
	"caddyui/internal/store"
)

// Server 持有渲染面板所需的一切。
type Server struct {
	svc      *app.Service
	assets   fs.FS
	index    *template.Template
	version  string
	logins   *limiter
	configMu sync.Mutex
}

// New 构造面板的 http.Handler。
func New(svc *app.Service, assets fs.FS, version string) (http.Handler, error) {
	s := &Server{
		svc:     svc,
		assets:  assets,
		version: version,
		logins:  newLimiter(),
	}
	index, err := fs.ReadFile(assets, "dist/index.html")
	if err != nil {
		return nil, fmt.Errorf("前端资源缺失，请先执行 npm --prefix frontend ci 和 npm --prefix frontend run build: %w", err)
	}
	s.index, err = template.New("index.html").Parse(string(index))
	if err != nil {
		return nil, err
	}
	return s.routes(), nil
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	staticFS, err := fs.Sub(s.assets, "dist")
	if err != nil {
		log.Fatalf("加载静态资源失败: %v", err)
	}
	mux.Handle("GET /assets/", cacheStatic(http.FileServerFS(staticFS)))
	mux.Handle("GET /favicon.svg", cacheStatic(http.FileServerFS(staticFS)))

	// 未登录可访问
	mux.HandleFunc("GET /setup", s.handleSetupForm)
	mux.HandleFunc("POST /setup", s.handleSetupSubmit)
	mux.HandleFunc("GET /login", s.handleLoginForm)
	mux.HandleFunc("POST /login", s.handleLoginSubmit)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
	})

	// 需要登录
	mux.HandleFunc("POST /logout", s.auth(s.handleLogout))
	mux.HandleFunc("GET /{$}", s.auth(func(w http.ResponseWriter, r *http.Request) {
		redirect(w, r, "/sites")
	}))

	mux.HandleFunc("GET /sites", s.auth(s.handleSiteList))
	mux.HandleFunc("GET /sites/new", s.auth(s.handleSiteNewForm))
	mux.HandleFunc("POST /sites/new", s.auth(s.configChange(s.handleSiteCreate)))
	mux.HandleFunc("GET /sites/{id}/edit", s.auth(s.handleSiteEditForm))
	mux.HandleFunc("GET /sites/{id}/certificates", s.auth(s.handleSiteCertificates))
	mux.HandleFunc("POST /sites/{id}/edit", s.auth(s.configChange(s.handleSiteUpdate)))
	mux.HandleFunc("POST /sites/{id}/toggle", s.auth(s.configChange(s.handleSiteToggle)))
	mux.HandleFunc("POST /sites/{id}/delete", s.auth(s.configChange(s.handleSiteDelete)))

	mux.HandleFunc("GET /config", s.auth(s.handleConfig))
	mux.HandleFunc("POST /config/apply", s.auth(s.configChange(s.handleConfigApply)))
	mux.HandleFunc("POST /config/rollback/{id}", s.auth(s.configChange(s.handleConfigRollback)))

	mux.HandleFunc("GET /settings", s.auth(s.handleSettings))
	mux.HandleFunc("POST /settings/acme", s.auth(s.configChange(s.handleSettingsACME)))
	mux.HandleFunc("POST /settings/password", s.auth(s.handleSettingsPassword))
	mux.HandleFunc("POST /settings/caddy/check", s.auth(s.handleCaddyCheck))
	mux.HandleFunc("POST /settings/caddy/upgrade", s.auth(s.handleCaddyUpgrade))

	// 主题切换不需要登录：登录页和初始化页上也有这个按钮。
	mux.HandleFunc("POST /theme", s.handleThemePublic)

	return securityHeaders(mux)
}

// Keep publication and certificate cleanup together across panel mutations.
func (s *Server) configChange(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.configMu.Lock()
		defer s.configMu.Unlock()
		next(w, r)
	}
}

// handleThemePublic 是 /theme 的入口。它绕开了 auth 中间件（登录页也要能切主题），
// 所以 CSRF 那套得在这里自己补上。
//
// 这个端点本身没什么可攻击的——最坏的情况是别人让你的面板变成深色——但同源
// 检查基本是白送的，加上没有坏处。
func (s *Server) handleThemePublic(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil || !checkOrigin(r) {
		http.Error(w, "请求校验失败", http.StatusBadRequest)
		return
	}
	s.handleTheme(w, r)
}

// Radix uses inline styles for portal positioning and scroll locking; scripts remain self-only.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		if r.Method == http.MethodPost {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		}
		next.ServeHTTP(w, r)
	})
}

func cacheStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 静态资源是编进二进制的，同一个版本内不会变。
		w.Header().Set("Cache-Control", "public, max-age=3600")
		next.ServeHTTP(w, r)
	})
}

// The same authenticated route serves the React shell or its JSON page data.
func (s *Server) render(w http.ResponseWriter, r *http.Request, page string, data map[string]any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Add("Vary", "Accept")
	if !wantsJSON(r) {
		var buf bytes.Buffer
		if err := s.index.Execute(&buf, map[string]string{"Theme": themeFrom(r)}); err != nil {
			log.Printf("渲染前端入口失败: %v", err)
			http.Error(w, "内部错误", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = buf.WriteTo(w)
		return
	}
	if data == nil {
		data = map[string]any{}
	}
	data["Version"] = s.version
	data["Path"] = r.URL.Path
	data["Theme"] = themeFrom(r)
	data["Flash"] = takeFlash(w, r)
	if sess := sessionFrom(r.Context()); sess != nil {
		data["CSRF"] = sess.CSRF
	}
	if u := userFrom(r.Context()); u != nil {
		data["User"] = u
	}

	if sites, ok := data["Sites"].([]*store.Site); ok {
		views := make([]siteView, 0, len(sites))
		for _, site := range sites {
			views = append(views, viewSite(site))
		}
		data["Sites"] = views
	}
	if site, ok := data["Site"].(*store.Site); ok {
		data["Site"] = viewSite(site)
	}
	writeJSON(w, map[string]any{"page": page, "data": data})
}

type siteView struct {
	*store.Site
	Links         []store.SiteLink
	PrimaryDomain string
	UpstreamURL   string
	HasBasicAuth  bool
}

func viewSite(site *store.Site) siteView {
	return siteView{site, site.Links(), site.PrimaryDomain(), site.UpstreamURL(), site.HasBasicAuth()}
}

func wantsJSON(r *http.Request) bool { return r.Header.Get("Accept") == "application/json" }

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Add("Vary", "Accept")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("写入 JSON 响应失败: %v", err)
	}
}

// ---------- Flash 消息 ----------

const flashCookie = "caddyui_flash"

// Flash 是一条一次性提示。
type Flash struct {
	Kind    string // ok | err | warn
	Message string
}

func setFlash(w http.ResponseWriter, kind, msg string) {
	// Caddy 的报错可能很长，cookie 有 4KB 上限，截一下。
	if len(msg) > 1200 {
		msg = msg[:1200] + "……"
	}
	http.SetCookie(w, &http.Cookie{
		Name:     flashCookie,
		Value:    encodeFlash(kind, msg),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60,
	})
}

func takeFlash(w http.ResponseWriter, r *http.Request) *Flash {
	c, err := r.Cookie(flashCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	http.SetCookie(w, &http.Cookie{
		Name: flashCookie, Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	kind, msg, ok := decodeFlash(c.Value)
	if !ok {
		return nil
	}
	return &Flash{Kind: kind, Message: msg}
}

// flashOK / flashErr 是最常用的两个快捷方式。
func flashOK(w http.ResponseWriter, format string, a ...any) {
	setFlash(w, "ok", fmt.Sprintf(format, a...))
}

func flashErr(w http.ResponseWriter, format string, a ...any) {
	setFlash(w, "err", fmt.Sprintf(format, a...))
}

func flashWarn(w http.ResponseWriter, format string, a ...any) {
	setFlash(w, "warn", fmt.Sprintf(format, a...))
}

// ---------- 小工具 ----------

// redirect 是 303 跳转的简写，POST 之后统一用它，避免刷新重复提交。
func redirect(w http.ResponseWriter, r *http.Request, path string) {
	if wantsJSON(r) {
		writeJSON(w, map[string]string{"redirect": path})
		return
	}
	http.Redirect(w, r, path, http.StatusSeeOther)
}

// notFound 渲染一个朴素的 404。
func notFound(w http.ResponseWriter) {
	http.Error(w, "页面不存在", http.StatusNotFound)
}

// storeErrMessage 把存储层的错误转成能直接给用户看的话。
func storeErrMessage(err error) string {
	if err == store.ErrNotFound {
		return "记录不存在，可能已经被删除了"
	}
	return err.Error()
}
