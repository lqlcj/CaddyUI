import { Layers3 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <Layers3
      aria-hidden="true"
      strokeWidth={1.75}
      className={cn('size-8 shrink-0 text-foreground', className)}
    />
  )
}
