import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  Globe,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from '@/components/ui/empty'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ConfirmAction,
  IconButton,
  Notice,
  PageHeading,
  Disclosure,
} from '@/components/shared'
import { usePage } from '@/lib/page-context'
import type { PageData, Site } from '@/lib/types'

export function SitesPage({ data }: { data: PageData }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [deleting, setDeleting] = useState<Site | null>(null)
  const [cleanupCerts, setCleanupCerts] = useState(false)
  const { submit, busy } = usePage()
  const sites = data.Sites || []
  const filtered = useMemo(
    () =>
      sites.filter(
        (site) =>
          `${site.Domains} ${site.UpstreamURL} ${site.Note}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()) &&
          (status === 'all' || site.Enabled === (status === 'enabled')),
      ),
    [sites, query, status],
  )
  const stats = [
    {
      label: '全部站点',
      value: sites.length,
      detail: '反向代理规则',
      icon: Globe,
      color: '',
    },
    {
      label: '已启用',
      value: data.EnabledCount || 0,
      detail: '已开启的站点规则',
      icon: Power,
      color: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      label: 'HTTPS',
      value: data.HTTPSCount || 0,
      detail: '已配置 HTTPS 的站点',
      icon: ShieldCheck,
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Caddy 连接',
      value: data.Status?.Connected ? '已连接' : '未连接',
      detail: data.Status?.Addr || '',
      icon: Server,
      color: data.Status?.Connected
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-destructive',
    },
  ]
  return (
    <>
      <PageHeading title="站点概览" subtitle="反向代理 / 站点管理">
        <Button asChild>
          <Link to="/sites/new">
            <Plus />
            添加站点
          </Link>
        </Button>
      </PageHeading>
      <section
        aria-label="站点统计"
        className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
      >
        {stats.map(({ label, value, detail, icon: Icon, color }) => (
          <Card key={label} className="min-w-0 gap-3 py-5">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 sm:px-6">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="size-4 shrink-0 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <strong
                className={`mb-2 flex h-9 items-center font-semibold tabular-nums ${typeof value === 'number' ? 'text-3xl' : 'text-xl'} ${color}`}
              >
                {value}
              </strong>
              <CardDescription className="text-xs break-all">
                {detail}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>
      {!data.Status?.Connected && (
        <Notice kind="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm font-medium">
              Caddy 未连接，配置暂未同步
            </strong>
            <Button asChild variant="outline" size="sm">
              <Link to="/settings">查看设置</Link>
            </Button>
          </div>
          <Disclosure title="连接详情">
            <p className="mt-2">{data.Status?.Error}</p>
          </Disclosure>
        </Notice>
      )}
      <section aria-label="站点列表">
        <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            站点列表<Badge variant="secondary">{sites.length}</Badge>
          </h2>
          <div className="flex w-full gap-2 sm:w-auto">
            <InputGroup className="min-w-0 flex-1 sm:w-64">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="搜索站点"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索域名、上游或备注"
              />
            </InputGroup>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="站点状态" className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="enabled">已启用</SelectItem>
                <SelectItem value="disabled">已停用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="rounded-lg border">
          <Table className="table-fixed">
            <TableHeader className="hidden xl:table-header-group">
              <TableRow>
                <TableHead className="w-[32%] pl-4">域名 / 备注</TableHead>
                <TableHead className="w-[26%]">上游地址</TableHead>
                <TableHead className="w-[12%]">协议</TableHead>
                <TableHead className="w-[17%]">状态</TableHead>
                <TableHead className="w-[13%] pr-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((site) => (
                <TableRow
                  key={site.ID}
                  aria-label={site.PrimaryDomain}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 p-3 xl:table-row xl:p-0 [&>td]:whitespace-normal"
                >
                  <TableCell className="col-span-3 min-w-0 py-3 xl:pl-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                        <Globe className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="space-y-1">
                          {site.Links.map((link) =>
                            link.Linkable ? (
                              <a
                                key={link.Domain}
                                href={link.URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-center gap-1 text-sm font-medium hover:underline"
                              >
                                <span className="min-w-0 break-all">
                                  {link.Domain}
                                </span>
                                <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                              </a>
                            ) : (
                              <span
                                key={link.Domain}
                                className="block break-all text-sm font-medium"
                              >
                                {link.Domain}
                              </span>
                            ),
                          )}
                        </div>
                        {site.Note && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {site.Note}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="col-span-3 min-w-0 space-y-1.5 py-3">
                    <code className="block text-xs text-muted-foreground">
                      {site.UpstreamURL}
                    </code>
                    {site.HasBasicAuth && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <LockKeyhole className="size-3" />
                        访问密码
                      </span>
                    )}
                    {site.SkipTLSVerify && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        跳过证书校验
                      </p>
                    )}
                    {site.Advanced && (
                      <p className="text-xs text-muted-foreground">
                        自定义配置
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        site.HTTPS
                          ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                          : ''
                      }
                    >
                      {site.HTTPS && <ShieldCheck />}
                      {site.HTTPS ? 'HTTPS' : 'HTTP'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={site.Enabled}
                        disabled={busy}
                        aria-label={`启用站点 ${site.PrimaryDomain}`}
                        onCheckedChange={() =>
                          void submit(`/sites/${site.ID}/toggle`)
                        }
                      />
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {site.Enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="xl:pr-4">
                    <div className="flex justify-end">
                      <IconButton label={`编辑 ${site.PrimaryDomain}`} asChild>
                        <Link to={`/sites/${site.ID}/edit`}>
                          <Pencil />
                        </Link>
                      </IconButton>
                      <IconButton
                        label={`删除 ${site.PrimaryDomain}`}
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setCleanupCerts(false)
                          setDeleting(site)
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filtered.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Globe />
              </EmptyMedia>
              <EmptyTitle>
                {sites.length ? '没有匹配的站点' : '暂无站点'}
              </EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              {sites.length ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('')
                    setStatus('all')
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/sites/new">
                    <Plus />
                    添加站点
                  </Link>
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}
        <div className="flex flex-wrap justify-between gap-2 py-4 text-xs text-muted-foreground">
          <span role="status">
            显示 {filtered.length} / {sites.length} 个站点
          </span>
          <span>状态以已保存的站点规则为准</span>
        </div>
      </section>
      <ConfirmAction
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="删除站点"
        description={`确定删除 ${deleting?.PrimaryDomain || ''}？站点设置将被删除，上游应用和配置历史保留。`}
        destructive
        onConfirm={() =>
          submit(
            `/sites/${deleting!.ID}/delete`,
            new URLSearchParams({ cleanup_certs: cleanupCerts ? '1' : '0' }),
          )
        }
      >
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={cleanupCerts}
              disabled={busy}
              onCheckedChange={(checked) => setCleanupCerts(checked === true)}
            />
            <span>同时清理该站点独占的证书、私钥和元数据</span>
          </label>
          <p className="text-xs text-muted-foreground">
            共用或无法确认归属的证书会保留。若其他程序引用这些证书，请勿勾选。清理后恢复站点可能需要重新申请证书。
          </p>
        </div>
      </ConfirmAction>
    </>
  )
}
