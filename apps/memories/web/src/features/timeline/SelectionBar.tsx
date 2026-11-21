import { useState } from 'react'
import { Heart, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import type { AssetSource } from './store'
import { useAssetActions } from '@/features/viewer/actions'

/** Bottom glass bar shown in Select mode. */
export function SelectionBar({
  source,
  ids,
  onDone,
  trashMode,
}: {
  source: AssetSource
  ids: Set<string>
  onDone: () => void
  trashMode?: boolean
}) {
  const actions = useAssetActions(source)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const n = ids.size
  const list = [...ids]
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
        style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
      >
        <div className="glass flex h-[62px] w-full max-w-[460px] items-center justify-between rounded-full px-2">
          {trashMode ? (
            <button
              disabled={!n || busy}
              onClick={() => run(() => actions.restore(list))}
              className="flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-accent disabled:opacity-40"
            >
              <RotateCcw className="size-5" /> Recover
            </button>
          ) : (
            <button
              aria-label="Favorite selected"
              disabled={!n || busy}
              onClick={() => run(() => actions.setFavorite(list, true))}
              className="flex size-11 items-center justify-center rounded-full text-accent disabled:opacity-40"
            >
              <Heart className="size-[22px]" />
            </button>
          )}
          <span className="text-[15px] font-semibold">{n ? `${n.toLocaleString()} Selected` : 'Select Items'}</span>
          {trashMode ? (
            <span className="w-11" />
          ) : (
            <button
              aria-label="Delete selected"
              disabled={!n || busy}
              onClick={() => setConfirm(true)}
              className="flex size-11 items-center justify-center rounded-full text-accent disabled:opacity-40"
            >
              <Trash2 className="size-[22px]" />
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <ConfirmSheet
          message={`${n.toLocaleString()} item${n === 1 ? '' : 's'} will be moved to Recently Deleted.`}
          action={`Delete ${n.toLocaleString()} Item${n === 1 ? '' : 's'}`}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            run(() => actions.trash(list))
          }}
        />
      )}
    </>
  )
}
