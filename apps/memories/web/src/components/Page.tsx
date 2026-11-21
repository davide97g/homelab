import { useState, type ReactNode } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { GlassButton } from './Glass'
import { cn } from '@/lib/cn'

/** Scrolling page with a large title and a floating glass top bar. */
export function Page({
  title,
  back,
  right,
  children,
  grouped,
  bottomSpace = 120,
}: {
  title: string
  back?: boolean
  right?: ReactNode
  children: ReactNode
  grouped?: boolean
  bottomSpace?: number
}) {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  return (
    <div className={cn('fixed inset-0', grouped ? 'bg-grouped' : 'bg-bg')}>
      <div className="absolute inset-0 overflow-y-auto overscroll-contain" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}>
        <div className="mx-auto max-w-[1200px]" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 64px)', paddingBottom: bottomSpace }}>
          <h1 className="large-title px-4 pb-3">{title}</h1>
          {children}
        </div>
      </div>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-3 pb-5"
        style={{ paddingTop: 'max(10px, env(safe-area-inset-top))', background: scrolled ? 'var(--scrim)' : 'transparent' }}
      >
        {back ? (
          <GlassButton round aria-label="Back" className="pointer-events-auto" onClick={() => navigate(-1)}>
            <ChevronLeft className="size-6" />
          </GlassButton>
        ) : (
          <span className="size-11" />
        )}
        <div className={cn('truncate text-[17px] font-semibold transition-opacity', scrolled ? 'opacity-100' : 'opacity-0')}>{title}</div>
        <div className="pointer-events-auto flex min-w-11 justify-end">{right}</div>
      </div>
    </div>
  )
}

/** "Albums >" section header. */
export function SectionHeader({ title, to, className }: { title: string; to?: string; className?: string }) {
  const inner = (
    <>
      <span>{title}</span>
      {to && <ChevronRight className="size-5 text-label-2" strokeWidth={2.5} />}
    </>
  )
  return to ? (
    <Link to={to} className={cn('flex items-center gap-1 px-4 pt-6 pb-2.5 font-display text-[22px] font-bold tracking-[0.35px]', className)}>
      {inner}
    </Link>
  ) : (
    <h2 className={cn('flex items-center gap-1 px-4 pt-6 pb-2.5 font-display text-[22px] font-bold tracking-[0.35px]', className)}>{inner}</h2>
  )
}
