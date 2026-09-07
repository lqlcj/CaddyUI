import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw, Save, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ActionForm,
  ConfirmAction,
  CopyButton,
  DateTime,
  Field,
  Notice,
  PageHeading,
  Disclosure,
  Section,
  SubmitButton,
} from '@/components/shared'
import { usePage } from '@/lib/page-context'
import type { PageData } from '@/lib/types'

const localBindCommand = `sudo cp /etc/systemd/system/caddyui.service /etc/systemd/system/caddyui.service.bak && \\
sudo sed -i 's/-listen 0\\.0\\.0\\.0:81/-listen 127.0.0.1:81/' /etc/systemd/system/caddyui.service && \\
sudo systemctl daemon-reload && \\
sudo systemctl restart caddyui && \\
sleep 1 && \\
ss -lntp | grep ':81'`

export function SettingsPage({ data }: { data: PageData }) {
  const [upgrade, setUpgrade] = useState(false)
  const { submit, refresh, busy } = usePage()
  useEffect(() => {
    if (data.CaddyJob?.State !== 'running' || busy) return
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [data.CaddyJob?.State, refresh, busy])

  return (
    <>
      <PageHeading title="系统设置" subtitle="连接 / 证书 / 账户" />
      <div className="grid gap-x-10 xl:grid-cols-2">
        <Section title="Caddy 连接">
          <dl className="space-y-4 text-sm">
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
              <dt className="text-muted-foreground">Admin 地址</dt>
              <dd>
                <code className="text-xs">{data.Status?.Addr}</code>
              </dd>
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
              <dt className="text-muted-foreground">连接状态</dt>
              <dd>
                <Badge
                  variant={data.Status?.Connected ? 'secondary' : 'destructive'}
                >
                  {data.Status?.Connected ? '已连接' : '未连接'}
                </Badge>
                {!data.Status?.Connected && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {data.Status?.Error}
                  </p>
                )}
              </dd>
            </div>
            <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
              <dt className="text-muted-foreground">数据目录</dt>
              <dd>
                <code className="text-xs">{data.DataDir || '未找到'}</code>
                {!data.CertAvailable && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    无法读取证书目录
                  </p>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            连接地址通过启动参数 <code>-caddy</code> 设置，证书目录通过{' '}
            <code>-caddy-data</code> 指定。修改后需要重启面板。
          </p>
          <div className="mt-6 space-y-3 border-t pt-5">
            <h3 className="text-sm font-medium">81 端口仅限本机访问</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              仅适用于一键安装版本。执行前请确认 HTTPS
              域名可用，执行后无法再通过服务器 IP:81 访问。
            </p>
            <CopyButton text={localBindCommand} label="复制命令" />
          </div>
        </Section>
        <Section title="证书设置">
          <ActionForm action="/settings/acme">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">联系邮箱</h3>
              <p className="break-all font-mono text-xs">
                {data.ACMEEmail || '未设置'}
              </p>
              <p className="text-xs text-muted-foreground">
                使用管理员首次注册的邮箱，接收证书续期通知。
              </p>
            </div>
            <Field
              id="acme_ca"
              label="自定义 ACME 目录"
              hint="留空使用默认服务。测试证书不被浏览器信任。"
            >
              <Input
                id="acme_ca"
                name="acme_ca"
                defaultValue={data.ACMECA}
                type="url"
                placeholder="https://acme-staging-v02.api.letsencrypt.org/directory"
              />
            </Field>
            <SubmitButton>
              <Save />
              保存证书设置
            </SubmitButton>
          </ActionForm>
        </Section>
        <Section title="Caddy 内核">
          <div className="mb-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">当前版本</span>
              <strong className="font-mono text-sm">
                {data.CaddyVersion || '未找到'}
              </strong>
              {data.CaddyOutdated && (
                <Badge variant="secondary">有新版本</Badge>
              )}
              {data.CaddyLatest && !data.CaddyOutdated && data.CaddyVersion && (
                <Badge variant="outline">已是最新</Badge>
              )}
            </div>
            {data.CaddyVersionErr && (
              <p className="text-xs text-muted-foreground">
                {data.CaddyVersionErr}
              </p>
            )}
            {data.CaddyBinPath && (
              <code className="block text-xs text-muted-foreground">
                {data.CaddyBinPath}
              </code>
            )}
            {data.CaddyLatest && (
              <div className="space-y-2 text-xs">
                <a
                  className="underline underline-offset-4"
                  href={data.CaddyLatest.URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  最新版本 {data.CaddyLatest.Version}
                </a>
                <p className="text-muted-foreground">
                  <DateTime value={data.CaddyLatest.CheckedAt} /> 检查
                </p>
              </div>
            )}
            {!data.CaddyUpgradable && data.CaddyUpgradeBlocked && (
              <p className="text-xs text-muted-foreground">
                {data.CaddyUpgradeBlocked}
              </p>
            )}
          </div>
          {data.CaddyJob && (
            <Notice
              kind={
                data.CaddyJob.State === 'failed'
                  ? 'err'
                  : data.CaddyJob.State === 'running'
                    ? 'warn'
                    : 'ok'
              }
            >
              <strong className="font-medium">
                {data.CaddyJob.State === 'running'
                  ? '正在升级…'
                  : data.CaddyJob.State === 'failed'
                    ? '升级失败'
                    : '升级成功'}
              </strong>
              {data.CaddyJob.Err && <p>{data.CaddyJob.Err}</p>}
              {data.CaddyJob.Log && (
                <Disclosure title="升级日志">
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {data.CaddyJob.Log}
                  </pre>
                </Disclosure>
              )}
            </Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <ActionForm action="/settings/caddy/check">
              <SubmitButton variant="outline">
                <RefreshCw />
                检查更新
              </SubmitButton>
            </ActionForm>
            {data.CaddyUpgradable && data.CaddyOutdated && (
              <Button
                disabled={busy || data.CaddyJob?.State === 'running'}
                onClick={() => setUpgrade(true)}
              >
                <Upload />
                升级到 {data.CaddyLatest?.Version}
              </Button>
            )}
          </div>
        </Section>
        <Section title="修改密码">
          <ActionForm action="/settings/password">
            <Field id="old_password" label="当前密码">
              <Input
                id="old_password"
                name="old_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field id="new_password" label="新密码">
              <Input
                id="new_password"
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Field id="confirm_password" label="确认新密码">
              <Input
                id="confirm_password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              修改后所有登录会话都会失效。
            </p>
            <SubmitButton>
              <KeyRound />
              修改密码
            </SubmitButton>
          </ActionForm>
        </Section>
        <Section title="备份" className="xl:col-span-2">
          <p className="text-xs leading-7 text-muted-foreground">
            面板数据库：<code>/var/lib/caddyui/caddyui.db</code>
            <br />
            Caddy 数据目录：<code>{data.DataDir || '/var/lib/caddy'}</code>
            <br />
            备份需包含数据库、已签发证书和 ACME 账户密钥。
          </p>
        </Section>
      </div>
      <ConfirmAction
        open={upgrade}
        onOpenChange={setUpgrade}
        title={`升级 Caddy 到 ${data.CaddyLatest?.Version || ''}`}
        description="升级会重启 Caddy，所有网站会短暂中断。升级失败时由升级助手自动回滚。"
        onConfirm={() => submit('/settings/caddy/upgrade')}
      />
    </>
  )
}
