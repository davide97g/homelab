import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDownUp, ArrowLeft, Check, ChevronRight } from 'lucide-react'
import { resumeChapter, useSeries, useSeriesDetail, useSeriesMetadata } from '@/lib/kavita/queries'
import { chapterCover, seriesCover } from '@/lib/kavita/images'
import { STATUS_LABEL, type Chapter } from '@/lib/kavita/types'
import { authorName, chapterLabel, chapterName, cleanSummary, genres } from '@/lib/format'
import { Header } from '@/components/Header'
import { ButtonLink, Cover, Pill, ProgressLine } from '@/components/ui'

export function SeriesRoute() {
  const id = Number(useParams().id)
  const series = useSeries(id)
  const detail = useSeriesDetail(id)
  const meta = useSeriesMetadata(id)
  const [newestFirst, setNewestFirst] = useState(false)
  const [more, setMore] = useState(false)

  const chapters = detail.data ?? []
  const resume = resumeChapter(chapters)
  const allRead = chapters.length > 0 && chapters.every((c) => c.pagesRead >= c.pages)
  const started = chapters.some((c) => c.pagesRead > 0)
  const summary = cleanSummary(meta.data?.summary)
  const tags = genres(meta.data?.genres ?? [], 6)
  const writers = (meta.data?.writers ?? []).map(authorName).filter(Boolean)
  const facts = [
    meta.data && STATUS_LABEL[meta.data.publicationStatus],
    meta.data?.releaseYear ? String(meta.data.releaseYear) : null,
    chapters.length ? `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}` : null,
  ].filter(Boolean)
  const ordered = newestFirst ? [...chapters].reverse() : chapters

  const cta = !resume
    ? null
    : allRead
      ? { to: `/read/${chapters[0].id}`, label: 'Read again from the start' }
      : started
        ? { to: `/read/${resume.id}`, label: `Continue ${chapterLabel(resume).toLowerCase()}` }
        : { to: `/read/${resume.id}`, label: 'Start reading' }

  return (
    <div className="min-h-dvh pb-24">
      <Header />
      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        <Link to="/" className="mt-4 mb-6 inline-flex items-center gap-1.5 text-[0.95rem] text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" strokeWidth={2.4} /> Your shelf
        </Link>

        <div className="grid gap-8 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-12">
          <div className="mx-auto w-48 md:sticky md:top-8 md:w-full md:self-start">
            {series.data ? <Cover src={seriesCover(series.data)} alt="" /> : <div className="cover aspect-[2/3] w-full" />}
          </div>

          <div className="min-w-0">
            <h1 className="display text-[clamp(2.1rem,5vw,3.6rem)] leading-[1.02] font-bold text-balance">
              {series.data?.name ?? ' '}
            </h1>
            {writers.length > 0 && <p className="mt-2 text-[1.05rem] text-ink-2 italic">by {writers.join(', ')}</p>}
            {facts.length > 0 && <p className="mt-3 text-[0.95rem] text-ink-2">{facts.join(' · ')}</p>}

            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
              </div>
            )}

            {cta && (
              <div className="mt-7">
                <ButtonLink to={cta.to}>{cta.label}</ButtonLink>
              </div>
            )}

            {summary && (
              <section className="mt-9 max-w-2xl">
                <h2 className="display mb-2 text-[1.3rem] font-semibold">Story</h2>
                <p className={`leading-relaxed whitespace-pre-line text-ink ${more ? '' : 'line-clamp-4'}`}>{summary}</p>
                {summary.length > 280 && (
                  <button onClick={() => setMore((m) => !m)} className="mt-1 text-[0.9rem] text-ink-2 underline underline-offset-4 hover:text-ink">
                    {more ? 'Show less' : 'Read more'}
                  </button>
                )}
              </section>
            )}

            <section className="mt-10">
              <div className="mb-3 flex items-center justify-between border-b-2 border-ink pb-2">
                <h2 className="display text-[1.3rem] font-semibold">Chapters</h2>
                {chapters.length > 1 && (
                  <button
                    onClick={() => setNewestFirst((n) => !n)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.85rem] text-ink-2 hover:bg-sheet hover:text-ink"
                  >
                    <ArrowDownUp className="size-3.5" strokeWidth={2.4} />
                    {newestFirst ? 'Newest first' : 'Oldest first'}
                  </button>
                )}
              </div>

              {detail.isPending && <p className="py-6 text-ink-3">Opening the volume…</p>}
              <ol>
                {ordered.map((c) => (
                  <ChapterRow key={c.id} chapter={c} current={c.id === resume?.id && started && !allRead} />
                ))}
              </ol>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function ChapterRow({ chapter: c, current }: { chapter: Chapter; current: boolean }) {
  const read = c.pagesRead >= c.pages
  const partial = c.pagesRead > 0 && !read
  const name = chapterName(c)
  return (
    <li>
      <Link
        to={`/read/${c.id}`}
        className={`group flex items-center gap-4 rounded-2xl px-2 py-3 transition hover:bg-sheet ${read ? 'opacity-55 hover:opacity-100' : ''}`}
      >
        <img
          src={chapterCover(c.id)}
          alt=""
          loading="lazy"
          className="h-16 w-11 shrink-0 rounded-lg bg-kraft object-cover shadow-[0_6px_14px_-8px_rgb(58_29_22/0.6)]"
        />
        <div className="min-w-0 flex-1">
          <p className="display text-[1.05rem] leading-tight font-semibold">
            {chapterLabel(c)}
            {current && <span className="ml-2 align-middle text-[0.75rem] font-normal text-ink-2 italic">reading</span>}
          </p>
          {name && <p className="truncate text-[0.92rem] text-ink-2">{name}</p>}
          {partial && <ProgressLine read={c.pagesRead} total={c.pages} className="mt-2 h-[3px] max-w-40" />}
        </div>
        <span className="shrink-0 text-[0.85rem] text-ink-3 tabular-nums">
          {read ? <Check className="size-4 text-ink" strokeWidth={2.6} aria-label="Read" /> : partial ? `${c.pagesRead}/${c.pages}` : `${c.pages} p.`}
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" strokeWidth={2.4} />
      </Link>
    </li>
  )
}
