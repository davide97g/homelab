import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import type { SearchResponseDto } from '@/lib/api/types'
import { toTimelineAsset } from '@/lib/assets'
import { ListSource } from '@/features/timeline/store'
import { TimelineGrid } from '@/features/timeline/TimelineGrid'
import { useViewer } from '@/features/viewer/ViewerProvider'

/**
 * Grid over a paginated search endpoint (smart / metadata). Pages are pulled
 * as the user nears the end.
 */
export function ResultsGrid<R extends SearchResponseDto = SearchResponseDto>({
  queryKey,
  fetchPage,
  topInset,
  bottomInset,
  header,
  emptyText = 'No results',
}: {
  queryKey: unknown[]
  /** pageParam: undefined for the first page, else nextCursor / nextPage */
  fetchPage: (pageParam: string | undefined) => Promise<R>
  topInset: number
  bottomInset: number
  /** Or a function of the first page, once it's there (e.g. how a sentence was read). */
  header?: ReactNode | ((first: R | undefined) => ReactNode)
  emptyText?: string
}) {
  const viewer = useViewer()
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.assets.nextCursor ?? last.assets.nextPage ?? undefined,
  })
  const source = useMemo(() => new ListSource([]), [])
  useEffect(() => {
    source.setItems(q.data?.pages.flatMap((p) => p.assets.items.map(toTimelineAsset)) ?? [])
  }, [q.data, source])

  const [nearEnd, setNearEnd] = useState(false)
  const onVisible = useCallback((_f: number, last: number) => setNearEnd(last >= source.total - 30), [source])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [nearEnd, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <TimelineGrid
      source={source}
      topInset={topInset}
      bottomInset={bottomInset}
      header={typeof header === 'function' ? header(q.data?.pages[0]) : header}
      onOpen={(i) => viewer.open(source, i)}
      onVisible={onVisible}
      footer={isFetchingNextPage ? <Loader2 className="size-5 animate-spin text-label-2" /> : undefined}
      empty={
        <div className="absolute inset-x-0 flex justify-center text-label-2" style={{ top: topInset + 60 }}>
          {q.isLoading ? <Loader2 className="size-6 animate-spin" /> : q.isError ? <span className="text-destructive">{String((q.error as Error).message)}</span> : emptyText}
        </div>
      }
    />
  )
}
