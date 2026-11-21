import { cn } from '@/lib/cn'

/** Glass segmented control (Years · Months · All). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div role="tablist" className={cn('glass relative flex h-11 items-center rounded-full p-1', className)}>
      <div
        aria-hidden
        className="absolute top-1 bottom-1 rounded-full bg-fill transition-transform duration-300 ease-out"
        style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative z-10 h-full flex-1 rounded-full px-4 text-[14px] font-semibold transition-colors',
            o.value === value ? 'text-label' : 'text-label-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
