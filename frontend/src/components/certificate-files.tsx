import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemHeader, ItemTitle } from '@/components/ui/item'
import { CopyButton, DateTime, Notice, Section } from '@/components/shared'
import type { Certificate, PageData } from '@/lib/types'

interface CertificateData {
  Certs: Certificate[]
  CertRoot: string
  CertAvailable: boolean
}

export function CertificateFiles({ data }: { data: PageData }) {
  const [certificates, setCertificates] = useState<CertificateData>({
    Certs: data.Certs || [],
    CertRoot: data.CertRoot || '',
    CertAvailable: !!data.CertAvailable,
  })
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const siteID = data.Site!.ID

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const backend = import.meta.env.DEV ? '/backend' : ''
    fetch(`${backend}/sites/${siteID}/certificates`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('读取证书信息失败')
        const result = await response.json()
        if (!Array.isArray(result.Certs))
          throw new Error('无法读取证书，请重新登录后重试')
        if (!controller.signal.aborted) setCertificates(result)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '读取证书信息失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [siteID, revision])

  const pending =
    data.Site!.HTTPS && certificates.Certs.some((cert) => !cert.Found)
  useEffect(() => {
    if (!pending || error) return
    const timer = window.setInterval(
      () => setRevision((value) => value + 1),
      10000,
    )
    return () => window.clearInterval(timer)
  }, [pending, error])

  return (
    <Section title="证书文件" className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {certificates.CertRoot ? (
            <>
              证书目录：<code>{certificates.CertRoot}</code>
            </>
          ) : (
            '未配置 Caddy 证书目录'
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          刷新证书
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {!certificates.CertAvailable && (
        <Notice kind="warn">
          证书目录尚不存在或无法读取，请检查 Caddy 数据目录及面板读取权限。
        </Notice>
      )}
      <div className="space-y-4">
        {certificates.Certs.map((cert) => {
          const expired =
            cert.Parsed && new Date(cert.NotAfter).getTime() <= Date.now()
          const days = Math.max(
            0,
            Math.ceil(
              (new Date(cert.NotAfter).getTime() - Date.now()) / 86400000,
            ),
          )
          return (
            <Item
              key={cert.Domain}
              variant="outline"
              aria-label={`证书 ${cert.Domain}`}
            >
              <ItemHeader className="flex-wrap">
                <ItemTitle className="min-w-0 break-all">
                  <ShieldCheck className="size-4 shrink-0" />
                  {cert.Domain}
                </ItemTitle>
                <Badge variant={expired ? 'destructive' : 'secondary'}>
                  {!cert.Found
                    ? '尚未发现证书'
                    : !cert.Parsed
                      ? '无法解析'
                      : expired
                        ? '已过期'
                        : `剩余 ${days} 天`}
                </Badge>
              </ItemHeader>
              <ItemContent className="min-w-0 basis-full gap-4">
                {cert.Found ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {cert.Issuer}
                      {cert.Parsed && (
                        <>
                          {' '}
                          · <DateTime value={cert.NotBefore} /> 至{' '}
                          <DateTime value={cert.NotAfter} />
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="mb-1 text-xs text-muted-foreground">
                          证书路径
                        </p>
                        <code className="break-all text-xs">
                          {cert.CertPath}
                        </code>
                      </div>
                      <CopyButton text={cert.CertPath} label="复制证书路径" />
                    </div>
                    {cert.KeyPath ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="mb-1 text-xs text-muted-foreground">
                            私钥路径
                          </p>
                          <code className="break-all text-xs">
                            {cert.KeyPath}
                          </code>
                        </div>
                        <CopyButton text={cert.KeyPath} label="复制私钥路径" />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        未找到对应的私钥文件。
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {data.Site!.HTTPS
                      ? '尚未发现已签发的证书。请确认域名解析、80/443 端口及 Caddy 证书申请状态。'
                      : '此站点未启用 HTTPS。'}
                  </p>
                )}
              </ItemContent>
            </Item>
          )
        })}
      </div>
    </Section>
  )
}
