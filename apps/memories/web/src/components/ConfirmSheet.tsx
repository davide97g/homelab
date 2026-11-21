import { cn } from '@/lib/cn'

/** iOS-style destructive action sheet. */
export function ConfirmSheet({
  message,
  action,
  onConfirm,
  onCancel,
  dark,
}: {
  message: string
  action: string
  onConfirm: () => void
  onCancel: () => void
  dark?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3 sm:items-center" onClick={onCancel} style={{ animation: 'fade-in 150ms ease-out' }}>
      <div
        className="w-full max-w-[420px] space-y-2"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'sheet-in 260ms cubic-bezier(.2,.8,.2,1)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className={cn('overflow-hidden rounded-[14px]', dark ? 'glass-dark' : 'glass')}>
          <p className={cn('px-4 py-3 text-center text-[13px]', dark ? 'text-white/60' : 'text-label-2')}>{message}</p>
          <button
            autoFocus
            onClick={onConfirm}
            className={cn('h-14 w-full border-t text-[17px] text-destructive', dark ? 'border-white/15' : 'border-separator')}
          >
            {action}
          </button>
        </div>
        <button onClick={onCancel} className={cn('h-14 w-full rounded-[14px] text-[17px] font-semibold', dark ? 'bg-[#2c2c2e] text-[#0a84ff]' : 'bg-card text-accent')}>
          Cancel
        </button>
      </div>
    </div>
  )
}
