import { useState, type ReactNode, type ComponentProps } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Field as UIField,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { usePage } from '@/lib/page-context'
import { cn } from '@/lib/utils'

export function IconButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  )
}

export function Section({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <FieldSet className={cn('min-w-0 border-t py-6', className)}>
      <FieldLegend>{title}</FieldLegend>
      {children}
    </FieldSet>
  )
}

export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string
  id: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <UIField className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </UIField>
  )
}

export function ActionForm({
  action,
  children,
  className,
}: {
  action: string
  children: ReactNode
  className?: string
}) {
  const { submit, busy, loading } = usePage()
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        const values = new URLSearchParams()
        new FormData(event.currentTarget).forEach((value, key) => {
          if (typeof value === 'string') values.append(key, value)
        })
        void submit(action, values)
      }}
    >
      <fieldset
        disabled={busy || loading}
        className="m-0 min-w-0 space-y-5 border-0 p-0"
      >
        {children}
      </fieldset>
    </form>
  )
}

export function SubmitButton({
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const { busy, loading } = usePage()
  return (
    <Button type="submit" disabled={busy || loading} {...props}>
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  )
}

export function Notice({
  kind = 'err',
  children,
  onClose,
}: {
  kind?: 'ok' | 'warn' | 'err'
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <Alert
      role={kind === 'err' ? 'alert' : 'status'}
      variant={kind === 'err' ? 'destructive' : 'default'}
      className={cn(
        'relative mb-5 min-w-0',
        onClose && 'pr-14',
        kind === 'ok'
          ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : kind === 'warn'
            ? 'border-amber-500/25 bg-amber-500/5 text-amber-800 dark:text-amber-300'
            : 'border-destructive/25 bg-destructive/5 text-destructive',
      )}
    >
      {kind === 'ok' ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <AlertDescription className="min-w-0 break-words text-inherit [overflow-wrap:anywhere]">
        {children}
      </AlertDescription>
      {onClose && (
        <IconButton
          label="关闭提示"
          className="absolute right-2 top-2"
          onClick={onClose}
        >
          <X />
        </IconButton>
      )}
    </Alert>
  )
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'content' : undefined}
    >
      <AccordionItem value="content">
        <AccordionTrigger>{title}</AccordionTrigger>
        {/* Keep collapsed form values mounted so saving preserves advanced settings. */}
        <AccordionContent forceMount className="[[data-state=closed]>&]:hidden">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  destructive = false,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => Promise<unknown>
  destructive?: boolean
  children?: ReactNode
}) {
  const { busy } = usePage()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={destructive ? 'destructive' : 'default'}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm().then(() => onOpenChange(false))
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}确认
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext)
        await navigator.clipboard.writeText(text)
      else {
        const input = document.createElement('textarea')
        input.value = text
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        const ok = document.execCommand('copy')
        input.remove()
        if (!ok) throw new Error('copy failed')
      }
      setCopied(true)
      setFailed(false)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setFailed(true)
    }
  }
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? '已复制' : label}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          复制失败
        </span>
      )}
    </div>
  )
}

export function DateTime({ value }: { value: number | string }) {
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}
    </time>
  )
}
