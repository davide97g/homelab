import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, originalUrl } from '@/lib/api/client'
import { invalidateTimelines, type AssetSource } from '@/features/timeline/store'

export function useAssetActions(source: AssetSource) {
  const qc = useQueryClient()

  const setFavorite = useCallback(
    async (ids: string[], isFavorite: boolean) => {
      for (const id of ids) source.patch(id, { isFavorite })
      try {
        await api.updateAssets(ids, { isFavorite })
      } catch (e) {
        for (const id of ids) source.patch(id, { isFavorite: !isFavorite })
        throw e
      }
      invalidateTimelines(source)
      for (const id of ids) qc.invalidateQueries({ queryKey: ['asset', id] })
    },
    [source, qc],
  )

  const trash = useCallback(
    async (ids: string[]) => {
      await api.trashAssets(ids)
      source.remove(ids)
      invalidateTimelines(source)
      qc.invalidateQueries({ queryKey: ['albums'] })
    },
    [source, qc],
  )

  const restore = useCallback(
    async (ids: string[]) => {
      await api.restoreAssets(ids)
      source.remove(ids)
      invalidateTimelines(source)
    },
    [source],
  )

  return { setFavorite, trash, restore }
}

/** Share sheet with the original file where supported, else a download. */
export async function shareAsset(id: string, filename = 'memory') {
  const url = originalUrl(id)
  try {
    if (navigator.canShare) {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (res.ok) {
        const blob = await res.blob()
        const file = new File([blob], filename, { type: blob.type })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] })
          return
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
