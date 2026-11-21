import { clsx } from 'clsx'
import { AlertTriangle, Check, CheckCircle2, Copy, Info, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={clsx('mx-auto flex min-h-dvh flex-col px-4 py-10 sm:py-16', wide ? 'max-w-4xl' : 'max-w-sm justify-center')}>
      {children}
    </main>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
        size === 'md' ? 'h-11 px-5 text-sm' : 'h-8 px-3 text-xs',
        variant === 'primary' && 'bg-fg text-canvas hover:bg-white',
        variant === 'ghost' && 'bg-surface-2 text-fg hover:bg-line',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        variant === 'quiet' && 'text-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'h-12 w-full rounded-xl border border-line bg-surface px-4 text-base outline-none placeholder:text-muted focus:border-muted',
        className,
      )}
    />
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="text-sm text-danger">{children}</p> : null
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('rounded-2xl bg-surface p-5', className)}>{children}</section>
}

export type Tone = 'muted' | 'ok' | 'warn' | 'danger'

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'muted' && 'bg-surface-2 text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'danger' && 'bg-danger/15 text-danger',
      )}
    >
      {children}
    </span>
  )
}

const TONE_ICON = { muted: Info, ok: CheckCircle2, warn: AlertTriangle, danger: XCircle } as const

/** A boxed message: what is going on, why, and the buttons that fix it. */
export function Callout({
  tone = 'muted',
  title,
  children,
  actions,
  className,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const Icon = TONE_ICON[tone]
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-xl border p-3.5 text-sm',
        tone === 'muted' && 'border-line bg-surface-2/60',
        tone === 'ok' && 'border-ok/25 bg-ok/8',
        tone === 'warn' && 'border-warn/25 bg-warn/8',
        tone === 'danger' && 'border-danger/25 bg-danger/8',
        className,
      )}
    >
      <Icon
        className={clsx(
          'mt-0.5 size-4 shrink-0',
          tone === 'muted' && 'text-muted',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
        )}
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx('text-muted', title && 'mt-1')}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

/** Copy to clipboard with a moment of "copied". */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {label && (done ? 'Copiato' : label)}
    </button>
  )
}

/** Steps or a shell command, copyable. */
export function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative mt-2 rounded-lg bg-canvas">
      <pre className="overflow-x-auto p-3 pr-16 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg/90">{children}</pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={children} label="Copia" />
      </div>
    </div>
  )
}

/** A centered dialog. Escape and the backdrop close it. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button className="text-muted hover:text-fg" onClick={onClose} aria-label="Chiudi">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T
  onChange: (t: T) => void
  tabs: { id: T; label: ReactNode; badge?: { n: number; tone: Tone } }[]
}) {
  return (
    <div className="mb-6 inline-flex self-start rounded-full bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
            value === t.id ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.badge && t.badge.n > 0 && (
            <span
              className={clsx(
                'grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] leading-5',
                t.badge.tone === 'danger' ? 'bg-danger text-white' : t.badge.tone === 'warn' ? 'bg-warn text-canvas' : 'bg-line text-fg',
              )}
            >
              {t.badge.n}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Initials in a circle. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span className={clsx('grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-line to-surface-2 text-sm font-semibold', className)}>
      {initials || '•'}
    </span>
  )
}
