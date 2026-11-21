import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Round or capsule liquid-glass button. */
export function GlassButton({
  className,
  children,
  round,
  dark,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { round?: boolean; dark?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        dark ? 'glass-dark' : 'glass text-label',
        'inline-flex items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold transition active:scale-95 disabled:opacity-40',
        round ? 'size-11 shrink-0' : 'h-11 px-4',
        active && 'bg-accent! text-white',
        className,
      )}
    >
      {children}
    </button>
  )
}
