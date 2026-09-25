import { clsx } from 'clsx'
import { Link } from 'react-router-dom'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { percent } from '@/lib/format'

export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className="inline-flex items-end gap-2 select-none">
      <span
        className={clsx(
          'display-wonk font-black leading-none text-ink',
          lg ? 'text-[clamp(4rem,14vw,7rem)]' : 'text-[1.9rem]',
        )}
        style={{ fontWeight: 900 }}
      >
        Yomu
      </span>
      <span
        className={clsx(
          'font-kana font-bold text-ink-2 leading-none',
          lg ? 'mb-3 text-xl tracking-[0.3em]' : 'mb-1 text-[0.7rem] tracking-[0.25em]',
        )}
      >
        よむ
      </span>
    </span>
  )
}

export function Bubble({
  children,
  className,
  up,
  tailX,
}: {
  children: ReactNode
  className?: string
  up?: boolean
  tailX?: string
}) {
  return (
    <div
      className={clsx('bubble pop', up && 'bubble-up', className)}
      style={tailX ? ({ '--tail-x': tailX } as CSSProperties) : undefined}
    >
      {children}
    </div>
  )
}

type ButtonProps = ComponentProps<'button'> & { variant?: 'ink' | 'line' | 'ghost' }

export function Button({ variant = 'ink', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'display inline-flex items-center justify-center gap-2 rounded-full font-semibold transition',
        'disabled:cursor-default disabled:opacity-60 cursor-pointer',
        variant === 'ink' &&
          'bg-ink px-6 py-3 text-[1.05rem] text-sheet shadow-[3px_4px_0_var(--kraft)] hover:-translate-y-px active:translate-y-px active:shadow-none',
        variant === 'line' &&
          'border-2 border-ink px-4 py-2 text-[0.95rem] text-ink hover:bg-sheet active:translate-y-px',
        variant === 'ghost' && 'p-2 text-ink hover:bg-sheet',
        className,
      )}
    />
  )
}

export function ButtonLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className={clsx(
        'display inline-flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-[1.05rem] font-semibold text-sheet',
        'shadow-[3px_4px_0_var(--kraft)] transition hover:-translate-y-px active:translate-y-px active:shadow-none',
        className,
      )}
    />
  )
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border-[1.5px] border-ink/70 px-3 py-0.5 text-[0.8rem] text-ink">
      {children}
    </span>
  )
}

export function ProgressLine({ read, total, className }: { read: number; total: number; className?: string }) {
  const p = percent(read, total)
  return (
    <div
      className={clsx('h-[5px] overflow-hidden rounded-full bg-rule', className)}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${p}%` }} />
    </div>
  )
}

export function Cover({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={clsx('cover w-full', className)} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  )
}
