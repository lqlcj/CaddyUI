import { useState } from 'react'
import { FileCode2, History, RefreshCw, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ActionForm,
  ConfirmAction,
  CopyButton,
  DateTime,
  Notice,
  PageHeading,
  Disclosure,
  SubmitButton,
} from '@/components/shared'
import { usePage } from '@/lib/page-context'
import type { PageData } from '@/lib/types'

export function ConfigPage({ data }: { data: PageData }) {
  const [rollback, setRollback] = useState<number | null>(null)
  const { submit, busy } = usePage()
  return (
    <>
      <PageHeading title="配置管理" subtitle="Caddyfile / 版本历史">
        <ActionForm action="/config/apply">
          <SubmitButton>
            <RefreshCw />
            重新下发
          </SubmitButton>
        </ActionForm>
      </PageHeading>
      <Notice kind={data.Status?.Connected ? 'ok' : 'warn'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="font-medium">
            Caddy {data.Status?.Connected ? '已连接' : '未连接'}
          </strong>
          <code className="text-xs">{data.Status?.Addr}</code>
        </div>
        {!data.Status?.Connected && (
          <p className="mt-2 text-xs">{data.Status?.Error}</p>
        )}
      </Notice>
      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">
            <FileCode2 className="size-4" />
            当前配置
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" />
            历史版本
            <Badge variant="secondary">{data.Versions?.length || 0}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Caddyfile</h2>
            <CopyButton text={data.Caddyfile || ''} label="复制配置" />
          </div>
          <pre className="min-h-72 max-w-full overflow-x-auto rounded-md border bg-card p-5 font-mono text-xs leading-7 text-muted-foreground">
            <code>{data.Caddyfile || '# 暂无配置'}</code>
          </pre>
        </TabsContent>
        <TabsContent value="history" className="mt-6">
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <TableHeader className="border-y bg-muted/50 text-xs text-muted-foreground">
                <TableRow>
                  <TableHead className="p-3 font-medium">版本</TableHead>
                  <TableHead className="p-3 font-medium">时间</TableHead>
                  <TableHead className="p-3 font-medium">操作</TableHead>
                  <TableHead className="p-3 font-medium">结果</TableHead>
                  <TableHead className="p-3">
                    <span className="sr-only">回滚</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.Versions?.map((version) => (
                  <TableRow key={version.ID} className="border-b">
                    <TableCell className="p-3 font-mono text-xs">
                      #{version.ID}
                    </TableCell>
                    <TableCell className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                      <DateTime value={version.CreatedAt} />
                    </TableCell>
                    <TableCell className="min-w-40 p-3">
                      <span className="text-xs">{version.Reason}</span>
                      {!version.OK && version.Detail && (
                        <Disclosure title="错误详情">
                          <pre className="mt-2 max-w-md whitespace-pre-wrap break-all">
                            {version.Detail}
                          </pre>
                        </Disclosure>
                      )}
                    </TableCell>
                    <TableCell className="p-3">
                      <Badge variant={version.OK ? 'secondary' : 'destructive'}>
                        {version.OK ? '已生效' : '被拒绝'}
                      </Badge>
                    </TableCell>
                    <TableCell className="p-3 text-right">
                      {version.OK && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setRollback(version.ID)}
                        >
                          <RotateCcw />
                          回滚
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!data.Versions?.length && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>暂无配置历史</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </Tabs>
      <ConfirmAction
        open={rollback !== null}
        onOpenChange={(open) => {
          if (!open) setRollback(null)
        }}
        title={`回滚到版本 #${rollback}`}
        description="这会替换 Caddy 当前运行的配置。站点列表不会跟随回滚，下次保存站点将重新下发当前列表。"
        onConfirm={() => submit(`/config/rollback/${rollback}`)}
      />
    </>
  )
}
