import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field as UIField,
  FieldContent,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ActionForm,
  Field,
  PageHeading,
  Disclosure,
  SubmitButton,
} from '@/components/shared'
import { CertificateFiles } from '@/components/certificate-files'
import { usePage } from '@/lib/page-context'
import type { PageData } from '@/lib/types'

function SettingSwitch({
  id,
  label,
  hint,
  checked,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
}) {
  return (
    <UIField orientation="horizontal" className="border-b py-4">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </FieldContent>
      <Switch id={id} name={id} defaultChecked={checked} className="shrink-0" />
    </UIField>
  )
}

export function SiteFormPage({
  data,
  modal = false,
}: {
  data: PageData
  modal?: boolean
}) {
  const site = data.Site!
  const { busy } = usePage()
  const navigate = useNavigate()
  const [scheme, setScheme] = useState(site.UpstreamScheme)
  return (
    <>
      {!modal && (
        <PageHeading
          title={data.Title || '站点'}
          subtitle="站点管理 / 反向代理规则"
        >
          <Button variant="outline" asChild>
            <Link to="/sites">
              <ArrowLeft />
              返回站点
            </Link>
          </Button>
        </PageHeading>
      )}
      <div className={modal ? 'min-w-0' : 'max-w-4xl border-t py-6'}>
        <ActionForm action={data.Action!}>
          <Field
            id="domains"
            label="域名"
            hint="一行一个域名；域名需要解析到这台服务器。"
          >
            <Textarea
              id="domains"
              name="domains"
              defaultValue={data.DomainsText}
              rows={3}
              required
              autoFocus
              spellCheck={false}
              placeholder={'example.com\nwww.example.com'}
            />
          </Field>
          <Field id="upstream_host" label="上游地址">
            <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 sm:grid-cols-[112px_minmax(0,1fr)_100px]">
              <Select
                name="upstream_scheme"
                value={scheme}
                onValueChange={setScheme}
              >
                <SelectTrigger aria-label="上游协议" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http://</SelectItem>
                  <SelectItem value="https">https://</SelectItem>
                </SelectContent>
              </Select>
              <Input
                id="upstream_host"
                name="upstream_host"
                defaultValue={site.UpstreamHost}
                required
                spellCheck={false}
                placeholder="127.0.0.1"
              />
              <Input
                name="upstream_port"
                aria-label="上游端口"
                defaultValue={site.UpstreamPort || ''}
                type="number"
                min={1}
                max={65535}
                placeholder="8080"
                className="col-span-2 sm:col-span-1"
              />
            </div>
          </Field>
          <SettingSwitch
            id="https"
            label="启用 HTTPS"
            hint="自动申请和续期证书，需要开放 80 和 443 端口。"
            checked={site.HTTPS}
          />
          <Field id="note" label="备注">
            <Input
              id="note"
              name="note"
              defaultValue={site.Note}
              maxLength={200}
            />
          </Field>
          <Disclosure title="高级选项">
            <div className="space-y-5 pt-3">
              <SettingSwitch
                id="force_https"
                label="强制跳转 HTTPS"
                hint="将 HTTP 请求重定向到 HTTPS。"
                checked={site.ForceHTTPS}
              />
              <SettingSwitch
                id="skip_tls_verify"
                label="忽略上游证书错误"
                hint="仅在 HTTPS 上游使用自签证书时开启。"
                checked={site.SkipTLSVerify}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="basic_user"
                  label="访问密码 · 用户名"
                  hint="清空用户名可移除访问密码。"
                >
                  <Input
                    id="basic_user"
                    name="basic_user"
                    defaultValue={site.BasicUser}
                    autoComplete="off"
                  />
                </Field>
                <Field id="basic_pass" label="访问密码 · 密码">
                  <Input
                    id="basic_pass"
                    name="basic_pass"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      site.HasBasicAuth ? '留空表示不修改' : '至少 4 位'
                    }
                  />
                </Field>
              </div>
              <Field
                id="advanced"
                label="自定义 Caddyfile 片段"
                hint="直接插入站点配置块。Caddy 拒绝配置时，线上会继续使用上一次生效的配置。"
              >
                <Textarea
                  id="advanced"
                  name="advanced"
                  defaultValue={site.Advanced}
                  spellCheck={false}
                  rows={6}
                  className="font-mono text-xs"
                  placeholder={'encode gzip\nheader X-Frame-Options SAMEORIGIN'}
                />
              </Field>
              {!data.IsNew && <CertificateFiles data={data} />}
            </div>
          </Disclosure>
          <div className="flex gap-3">
            <SubmitButton>
              <Save />
              保存并生效
            </SubmitButton>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => navigate('/sites')}
            >
              取消
            </Button>
          </div>
        </ActionForm>
      </div>
    </>
  )
}
