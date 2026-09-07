import { useEffect, useState, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { PageData } from '@/lib/types'
import { BrandMark } from '@/components/brand-mark'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  FileCode2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  ChevronsUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton, Notice } from '@/components/shared'
import { usePage } from '@/lib/page-context'
import { SitesPage } from '@/pages/sites'
import { SiteFormPage } from '@/pages/site-form'
import { ConfigPage } from '@/pages/config'
import { SettingsPage } from '@/pages/settings'
import { AuthPage } from '@/pages/auth'

const navigation = [
  { path: '/sites', title: '站点概览', icon: LayoutDashboard },
  { path: '/config', title: '配置管理', icon: FileCode2 },
  { path: '/settings', title: '系统设置', icon: Settings2 },
]

function Brand() {
  return (
    <Link
      to="/sites"
      className="flex items-center gap-2.5 text-lg font-semibold group-data-[collapsible=icon]:justify-center"
    >
      <BrandMark />
      <span className="group-data-[collapsible=icon]:hidden">CaddyUI</span>
    </Link>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    document.documentElement.classList.contains('dark'),
  )
  return (
    <IconButton
      label={dark ? '切换浅色主题' : '切换深色主题'}
      onClick={() => {
        const next = !dark
        document.documentElement.classList.toggle('dark', next)
        document.cookie = `caddyui_theme=${next ? 'dark' : 'light'};path=/;max-age=31536000;samesite=lax`
        setDark(next)
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  )
}

function Navigation() {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu aria-label="主导航">
      {navigation.map(({ path, title, icon: Icon }) => (
        <SidebarMenuItem key={path}>
          <SidebarMenuButton
            asChild
            isActive={location.pathname.startsWith(path)}
            tooltip={title}
          >
            <Link to={path} onClick={() => setOpenMobile(false)}>
              <Icon />
              <span>{title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

export default function App() {
  const { current, loading, busy, error, clearError, refresh, submit } =
    usePage()
  const location = useLocation()
  const navigate = useNavigate()
  const sitesBackground = useRef<PageData | null>(null)
  useEffect(() => {
    if (current?.page === 'sites') sitesBackground.current = current.data
    if (!current?.data.User) sitesBackground.current = null
  }, [current])
  const [dismissedFlash, setDismissedFlash] = useState<object | null>(null)
  const title =
    current?.data.Title ||
    navigation.find((item) => location.pathname.startsWith(item.path))?.title ||
    (current?.page === 'setup' ? '初始化' : '登录')
  useEffect(() => {
    document.title = `${title} · CaddyUI`
  }, [title])

  if (!current)
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        {error ? (
          <>
            <Notice>{error}</Notice>
            <Button onClick={refresh}>重试</Button>
            <Button variant="outline" asChild>
              <Link to="/sites">返回控制台</Link>
            </Button>
          </>
        ) : (
          <Loader2
            aria-label="正在加载"
            className="mx-auto size-6 animate-spin text-muted-foreground"
          />
        )}
      </div>
    )

  const { data, page } = current
  const siteDialog = page === 'site_form'
  const flash = data.Flash
  const content = (
    <>
      {error && !siteDialog && <Notice onClose={clearError}>{error}</Notice>}
      {flash && dismissedFlash !== flash && (
        <Notice kind={flash.Kind} onClose={() => setDismissedFlash(flash)}>
          {flash.Message}
        </Notice>
      )}
      {data.Error && !siteDialog && <Notice>{data.Error}</Notice>}
      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-label="正在加载"
          />
        </div>
      ) : page === 'sites' ? (
        <SitesPage data={data} />
      ) : page === 'site_form' ? (
        <>
          {sitesBackground.current ? (
            <SitesPage data={sitesBackground.current} />
          ) : (
            <h1 className="text-2xl font-semibold">站点概览</h1>
          )}
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !busy) navigate('/sites')
            }}
          >
            <DialogContent
              className="max-h-[calc(100dvh_-_2rem)] max-w-[calc(100%_-_2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
              showCloseButton={!busy}
              onPointerDownOutside={(event) => {
                if (busy) event.preventDefault()
              }}
            >
              <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
                <DialogTitle>
                  {data.IsNew ? '添加站点' : '编辑站点'}
                </DialogTitle>
                <DialogDescription>
                  {data.IsNew ? '域名与反向代理配置' : data.Site?.PrimaryDomain}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-[calc(100dvh_-_9rem)]">
                <div className="min-w-0 space-y-6 p-6">
                  {error && <Notice onClose={clearError}>{error}</Notice>}
                  {data.Error && <Notice>{data.Error}</Notice>}
                  <SiteFormPage key={data.Path} data={data} modal />
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </>
      ) : page === 'config' ? (
        <ConfigPage data={data} />
      ) : page === 'settings' ? (
        <SettingsPage data={data} />
      ) : (
        <AuthPage data={data} setup={page === 'setup'} />
      )}
    </>
  )

  if (!data.User)
    return (
      <div className="flex min-h-screen flex-col">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
          {content}
        </main>
        <footer className="pb-6 text-center text-xs text-muted-foreground">
          CaddyUI {data.Version}
        </footer>
      </div>
    )

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only z-50 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:bg-background focus:p-3"
      >
        跳到主要内容
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="py-5">
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>工作空间</SidebarGroupLabel>
            <SidebarGroupContent>
              <Navigation />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" tooltip={data.User.Username}>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {data.User.Username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 text-left text-sm">
                  <span className="font-medium">管理员</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {data.User.Username}
                  </span>
                </span>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="break-all text-xs">
                {data.User.Username}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings2 />
                  账户设置
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onClick={() => void submit('/logout')}
              >
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger aria-label="打开导航" title="切换侧栏" />
            <Separator orientation="vertical" className="!h-4" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem className="hidden sm:block">
                  控制台
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label="刷新页面"
              disabled={loading || busy}
              onClick={refresh}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </IconButton>
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1600px] flex-1 p-4 py-6 sm:p-6 lg:p-8"
          aria-busy={loading}
        >
          {content}
        </main>
        <footer className="border-t px-4 py-4 text-xs text-muted-foreground sm:px-6">
          CaddyUI {data.Version}
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
