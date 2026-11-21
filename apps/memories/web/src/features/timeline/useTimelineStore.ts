import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TimelineFilter } from '@/lib/api/types'
import { filterKey, getTimelineStore, type TimelineStore } from './store'

export function useTimelineStore(filter: TimelineFilter): TimelineStore {
  const key = filterKey(filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => getTimelineStore(filter), [key])
  useSyncExternalStore(store.subscribe, store.getVersion)
  useEffect(() => {
    store.init()
  }, [store])
  return store
}
