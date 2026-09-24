import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/kavita/auth'
import { resumeChapter, useLibrary, useOnDeck, useSeriesDetail, useSeriesMetadata } from '@/lib/kavita/queries'
import { seriesCover } from '@/lib/kavita/images'
import type { Series } from '@/lib/kavita/types'
import { chapterLabel, chapterName, genres, percent } from '@/lib/format'
import { Header } from '@/components/Header'
import { ScanButton } from '@/components/ScanButton'
import { Bubble, ButtonLink, Cover, Pill, ProgressLine } from '@/components/ui'

export function HomeRoute() {
  const { user, isAdmin } = useAuth()
  const [query, setQuery] = useState('')
  const library = useLibrary()
  const onDeck = useOnDeck()

  const all = library.data ?? []
  const deck = onDeck.data ?? []
  const newest = useMemo(
    () => [...all].sort((a, b) => b.lastChapterAddedUtc.localeCompare(a.lastChapterAddedUtc))[0],
    [all],
  )
  const hero = deck[0] ?? newest
  const reading = deck.slice(1)
  const q = query.trim().toLowerCase()
  const shelf = q
    ? all.filter((s) => [s.name, s.localizedName, s.sortName].some((n) => n?.toLowerCase().includes(q)))
    : all

  const name = user ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : ''

  return (
    <div className="min-h-dvh pb-24">
      <Header query={query} onQuery={setQuery} />

      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        {!q && (
          <>
            <Bubble tailX="30px" className="mt-6 mb-9 inline-block px-5 py-3 text-[1.1rem] sm:text-[1.2rem]">
              <span className="italic">Hi {name}.</span> What should we read today?
            </Bubble>

            {hero && <Hero series={hero} resuming={!!deck[0]} />}

            {reading.length > 0 && (
              <section className="mt-14">
                <h2 className="display mb-4 text-[1.5rem] font-semibold">Reading now</h2>
                <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
                  {reading.map((s) => (
                    <SeriesCard key={s.id} series={s} className="w-32 shrink-0 snap-start sm:w-36" />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <section className={q ? 'mt-8' : 'mt-14'}>
          <div className="mb-5 flex items-baseline gap-3">
            <h2 className="display text-[1.5rem] font-semibold">{q ? `Matching “${query.trim()}”` : 'Your shelf'}</h2>
            {library.isSuccess && <span className="text-[0.9rem] text-ink-3">{shelf.length}</span>}
          </div>

          {library.isPending && <ShelfSkeleton />}

          {library.isSuccess && shelf.length === 0 && (
            <EmptyShelf searching={!!q} canScan={isAdmin} />
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {shelf.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function Hero({ series, resuming }: { series: Series; resuming: boolean }) {
  const detail = useSeriesDetail(series.id)
  const meta = useSeriesMetadata(series.id)
  const chapter = detail.data ? resumeChapter(detail.data) : undefined
  const tags = genres(meta.data?.genres ?? [], 4)
  const started = !!chapter && chapter.pagesRead > 0

  return (
    <section className="relative overflow-hidden rounded-[32px] bg-sheet shadow-card">
      <div aria-hidden className="tone absolute inset-y-0 right-0 w-2/3 [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="relative grid gap-6 p-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-10 sm:p-9">
        <Link to={`/series/${series.id}`} className="mx-auto w-44 sm:w-full">
          <Cover src={seriesCover(series)} alt="" className="rotate-[-1.5deg] transition hover:rotate-0" />
        </Link>

        <div className="flex min-w-0 flex-col justify-center">
          <p className="mb-2 text-[0.85rem] tracking-wide text-ink-2">
            {resuming ? 'Pick up where you left off' : 'New on the shelf'}
          </p>
          <h1 className="display text-[clamp(2rem,5vw,3.4rem)] leading-[1.02] font-bold text-balance">
            <Link to={`/series/${series.id}`} className="hover:underline decoration-2 underline-offset-4">
              {series.name}
            </Link>
          </h1>

          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Pill key={t}>{t}</Pill>
              ))}
            </div>
          )}

          {chapter && (
            <div className="mt-6 max-w-md">
              <p className="text-[1.02rem]">
                <span className="display font-semibold">{chapterLabel(chapter)}</span>
                {chapterName(chapter) && <span className="text-ink-2"> · {chapterName(chapter)}</span>}
              </p>
              {started && (
                <div className="mt-3 flex items-center gap-3">
                  <ProgressLine read={chapter.pagesRead} total={chapter.pages} className="flex-1" />
                  <span className="shrink-0 text-[0.85rem] text-ink-2 tabular-nums">
                    page {chapter.pagesRead} of {chapter.pages}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-7">
            <ButtonLink to={chapter ? `/read/${chapter.id}` : `/series/${series.id}`}>
              {started ? 'Continue reading' : 'Start reading'}
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  )
}

function SeriesCard({ series, className }: { series: Series; className?: string }) {
  const p = percent(series.pagesRead, series.pages)
  return (
    <Link to={`/series/${series.id}`} className={`group block ${className ?? ''}`}>
      <div className="relative transition duration-300 group-hover:-translate-y-1">
        <Cover src={seriesCover(series)} alt="" />
        {p === 100 && (
          <span className="absolute right-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[0.7rem] text-sheet">Read</span>
        )}
      </div>
      <p className="display mt-3 line-clamp-2 text-[1rem] leading-tight font-semibold">{series.name}</p>
      {p > 0 && p < 100 && <ProgressLine read={series.pagesRead} total={series.pages} className="mt-2 h-[3px]" />}
    </Link>
  )
}

function EmptyShelf({ searching, canScan }: { searching: boolean; canScan: boolean }) {
  if (searching) return <p className="text-ink-2">No series by that name. Check the spelling, or clear the search.</p>
  return (
    <div className="flex flex-col items-start gap-5 rounded-[28px] border-2 border-dashed border-rule p-8">
      <p className="display text-[1.3rem] font-semibold">The shelf is empty.</p>
      <p className="max-w-md text-ink-2">
        Download a few chapters in Suwayomi, then scan the library to bring them here.
      </p>
      {canScan && <ScanButton />}
    </div>
  )
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <div className="cover w-full animate-pulse opacity-60" />
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-rule" />
        </div>
      ))}
    </div>
  )
}
