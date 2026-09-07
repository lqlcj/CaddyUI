// Package caddybin 管理 Caddy 二进制本身：读当前版本、查官方最新版、触发升级。
//
// 升级动作本身不在这里做 —— 面板以非特权的 caddy 用户运行，写不了
// /usr/bin/caddy 也重启不了服务。真正干活的是一个 root 拥有的助手脚本，
// 这里只通过受权限保护的 Unix socket 请求独立的 systemd 服务并收集结果。
//
// 权限边界的设计写在 deploy/upgrade-caddy.sh 的注释里，改这块之前先读那段。
package caddybin

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// UpgradeSocket must match deploy/caddyui-upgrade.socket.
const UpgradeSocket = "/run/caddyui-upgrade.sock"

// 官方仓库，硬编码。助手脚本里也硬编码了一份 —— 那份才是真正生效的，
// 这份只用来查版本和在界面上显示来源。
const (
	releaseAPI = "https://api.github.com/repos/caddyserver/caddy/releases/latest"
	releaseURL = "https://github.com/caddyserver/caddy/releases"
)

// checkTTL 是版本检查结果的缓存时长。
//
// GitHub 未认证 API 是每小时 60 次/IP，设置页每次打开都去查会很快把额度用光，
// 而且 Caddy 一年也发不了几个版本。用户想立刻看最新的可以点「检查更新」。
const checkTTL = 6 * time.Hour

// Release 是官方最新版本的信息。
type Release struct {
	Version   string // 形如 v2.11.4
	Published time.Time
	URL       string // release 页面地址，界面上给个链接
	CheckedAt time.Time
}

// State 是升级任务的状态。
type State string

const (
	StateIdle    State = "idle"
	StateRunning State = "running"
	StateOK      State = "ok"
	StateFailed  State = "failed"
)

// Job 是一次升级的运行记录。面板重启就没了，本来也只是给人看进度的。
type Job struct {
	State      State
	StartedAt  time.Time
	FinishedAt time.Time
	Log        string
	Err        string
}

// Manager 管理 Caddy 二进制。
type Manager struct {
	// BinPath 是 caddy 可执行文件的位置，空表示没找到。
	BinPath string

	mu       sync.Mutex
	latest   *Release
	job      Job
	httpOnce sync.Once
	hc       *http.Client
}

// New 构造管理器。binPath 留空则自动探测。
func New(binPath string) *Manager {
	m := &Manager{BinPath: strings.TrimSpace(binPath)}
	// 显式写上 idle：Job 的零值是空字符串，不写的话「从没跑过」和「状态未知」
	// 就分不开了，设置页会因此渲染出一个空的状态框。
	m.job.State = StateIdle
	if m.BinPath == "" {
		m.BinPath = detectBin()
	}
	return m
}

// detectBin 按常见位置找 caddy。
func detectBin() string {
	candidates := []string{"/usr/bin/caddy", "/usr/local/bin/caddy"}
	if runtime.GOOS == "windows" {
		candidates = []string{"caddy.exe", ".\\caddy.exe"}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	// 最后问一下 PATH。
	if p, err := exec.LookPath("caddy"); err == nil {
		return p
	}
	return ""
}

func (m *Manager) client() *http.Client {
	m.httpOnce.Do(func() {
		m.hc = &http.Client{Timeout: 20 * time.Second}
	})
	return m.hc
}

// verRe 匹配 `v2.11.4`，Caddy 的 version 输出第一段就是它。
var verRe = regexp.MustCompile(`^v?\d+\.\d+\.\d+`)

// CurrentVersion 跑一次 `caddy version` 读出当前版本。
//
// 不走 Admin API 是因为 Caddy 没有暴露版本的端点；而且升级这件事本来就关心
// 磁盘上那个文件是什么版本，问进程反而绕。
func (m *Manager) CurrentVersion() (string, error) {
	if m.BinPath == "" {
		return "", fmt.Errorf("没找到 caddy 可执行文件")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, m.BinPath, "version").Output()
	if err != nil {
		return "", fmt.Errorf("执行 %s version 失败: %w", m.BinPath, err)
	}
	// 输出形如：v2.11.4 h1:0uHhH0......=
	first := strings.Fields(strings.TrimSpace(string(out)))
	if len(first) == 0 {
		return "", fmt.Errorf("读不出版本号")
	}
	v := verRe.FindString(first[0])
	if v == "" {
		return "", fmt.Errorf("版本号格式不认识: %q", first[0])
	}
	return normalize(v), nil
}

// Latest 返回官方最新版本，带缓存。force 为真时忽略缓存强制查一次。
func (m *Manager) Latest(force bool) (*Release, error) {
	m.mu.Lock()
	cached := m.latest
	m.mu.Unlock()

	if !force && cached != nil && time.Since(cached.CheckedAt) < checkTTL {
		return cached, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "CaddyUI")

	resp, err := m.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上 GitHub：%w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("GitHub 接口限流了（每小时 60 次），过一会儿再试")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub 返回 HTTP %d", resp.StatusCode)
	}

	var payload struct {
		TagName     string    `json:"tag_name"`
		HTMLURL     string    `json:"html_url"`
		PublishedAt time.Time `json:"published_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("解析 GitHub 返回失败：%w", err)
	}
	if verRe.FindString(payload.TagName) == "" {
		return nil, fmt.Errorf("拿到的版本号不像版本号: %q", payload.TagName)
	}

	rel := &Release{
		Version:   normalize(payload.TagName),
		Published: payload.PublishedAt,
		URL:       payload.HTMLURL,
		CheckedAt: time.Now(),
	}
	if rel.URL == "" {
		rel.URL = releaseURL
	}

	m.mu.Lock()
	m.latest = rel
	m.mu.Unlock()
	return rel, nil
}

// CachedLatest 只读缓存，不发请求。设置页渲染时用它，避免每次打开页面都打 GitHub。
func (m *Manager) CachedLatest() *Release {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.latest
}

// HelperAvailable probes the independently privileged service without starting an upgrade.
//
// 不通的时候界面上要如实说明并给出手动命令，而不是给个点了会报错的按钮。
func (m *Manager) HelperAvailable() (bool, string) {
	if runtime.GOOS != "linux" {
		return false, "一键升级只支持 Linux（当前系统：" + runtime.GOOS + "）"
	}
	if _, err := helperRequest(UpgradeSocket, "CHECK", 5*time.Second); err != nil {
		return false, "升级服务不可用，请检查 caddyui-upgrade.socket 或重新运行安装脚本：" + err.Error()
	}
	return true, ""
}

// Job 返回当前（或最近一次）升级任务的状态。
func (m *Manager) Job() Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.job
}

// StartUpgrade 在后台跑一次升级。
//
// 做成异步而不是同步等着，有两个原因：下载加重启在慢机器上可能要一分钟以上，
// 会撞上 HTTP 写超时；而且升级过程中 Caddy 会重启，如果用户是通过 Caddy 反代
// 访问面板的，同步请求会连带被掐断，用户就看不到结果了。
func (m *Manager) StartUpgrade() error {
	if ok, why := m.HelperAvailable(); !ok {
		return fmt.Errorf("%s", why)
	}

	m.mu.Lock()
	if m.job.State == StateRunning {
		m.mu.Unlock()
		return fmt.Errorf("已经有一个升级任务在跑了")
	}
	m.job = Job{State: StateRunning, StartedAt: time.Now()}
	m.mu.Unlock()

	go m.runUpgrade()
	return nil
}

func (m *Manager) runUpgrade() {
	output, err := helperRequest(UpgradeSocket, "UPGRADE", 15*time.Minute)

	m.mu.Lock()
	defer m.mu.Unlock()
	m.job.FinishedAt = time.Now()
	m.job.Log = tail(output, 60)
	if err != nil {
		m.job.State = StateFailed
		m.job.Err = err.Error()
		return
	}
	m.job.State = StateOK
	// 升级成功后缓存的版本号就过时了，清掉，下次会重新查。
	m.latest = nil
}

func helperRequest(socket, command string, timeout time.Duration) (string, error) {
	if command != "CHECK" && command != "UPGRADE" {
		return "", fmt.Errorf("invalid upgrade command")
	}
	conn, err := net.DialTimeout("unix", socket, 3*time.Second)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return "", err
	}
	if _, err := io.WriteString(conn, command+"\n"); err != nil {
		return "", err
	}
	raw, err := io.ReadAll(io.LimitReader(conn, 128*1024+1))
	if err != nil {
		return "", err
	}
	if len(raw) > 128*1024 {
		return "", fmt.Errorf("upgrade response too large")
	}
	response := strings.TrimSpace(string(raw))
	if command == "CHECK" {
		if response != "READY" {
			return "", fmt.Errorf("upgrade service did not report readiness")
		}
		return "", nil
	}
	index := strings.LastIndex(response, "\nCADDYUI-UPGRADE-EXIT ")
	if index < 0 {
		return response, fmt.Errorf("升级连接中断，结果未知；请检查升级服务日志和 Caddy 状态")
	}
	output := strings.TrimSpace(response[:index])
	status := strings.TrimPrefix(response[index+1:], "CADDYUI-UPGRADE-EXIT ")
	if status != "0" {
		if line := lastLine(output); line != "" {
			return output, fmt.Errorf("%s", line)
		}
		return output, fmt.Errorf("升级失败（退出码 %s）", status)
	}
	return output, nil
}

// tail 只保留最后 n 行，防止把整篇输出灌进页面。
func tail(s string, n int) string {
	lines := make([]string, 0, n+1)
	sc := bufio.NewScanner(strings.NewReader(s))
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	return strings.Join(lines, "\n")
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return strings.TrimPrefix(l, "ERROR: ")
		}
	}
	return ""
}

// normalize 统一成带 v 前缀的形式，方便比较和显示。
func normalize(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if !strings.HasPrefix(v, "v") {
		return "v" + v
	}
	return v
}

// Newer 判断 latest 是否比 current 新。
//
// 只比较 x.y.z 三段数字。Caddy 一直是标准语义化版本，遇到解析不了的一律返回
// false —— 宁可不提示更新，也不要因为版本号格式变了就天天弹「有新版本」。
func Newer(current, latest string) bool {
	c, ok1 := parse(current)
	l, ok2 := parse(latest)
	if !ok1 || !ok2 {
		return false
	}
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

func parse(v string) ([3]int, bool) {
	var out [3]int
	v = verRe.FindString(strings.TrimSpace(v))
	if v == "" {
		return out, false
	}
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
