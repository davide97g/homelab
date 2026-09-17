import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { cn } from '@/lib/utils'
import { kindLabel } from './item-facts'

/** A red tick and a word. The tick is Cinema's mark, used at card scale. */
export function KindTag({ item, className }: { item: BaseItemDto; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <span aria-hidden className="h-3 w-[3px] rounded-pill bg-primary" />
      <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-foreground/70 uppercase">
        {kindLabel(item)}
      </span>
    </span>
  )
}

/**
 * Metadata as text separated by dots, never as chips. Chips made every card
 * look like a form; the dot line is what a film's credits read like.
 */
export function DotList({
  parts,
  className,
}: {
  parts: (string | null | undefined)[]
  className?: string
}) {
  const items = parts.filter(Boolean) as string[]
  if (!items.length) return null

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-muted-foreground', className)}>
      {items.map((part, index) => (
        <span key={part} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span aria-hidden className="size-0.5 shrink-0 rounded-pill bg-current" />}
          <span className="truncate">{part}</span>
        </span>
      ))}
    </span>
  )
}
