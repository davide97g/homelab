import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Header } from '@/components/Header'
import { Bubble, Spinner } from '@/components/ui'
import { useScriptSearch } from '@/lib/script/queries'
import type { SearchHit } from '@/lib/script/types'

// Who said what, where: full-text search over every chapter's script.
export function SearchRoute() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const input = useRef<HTMLInputElement>(null)
  const hits = useScriptSearch(q)

  useEffect(() => input.current?.focus(), [])
  // Keep the query in the URL, so a search can be shared and survives a reload.
  useEffect(() => {
    const t = setTimeout(() => setParams(q.trim() ? { q: q.trim() } : {}, { replace: true }), 300)
    return () => clearTimeout(t)
  }, [q, setParams])

  const groups = group(hits.data ?? [])
  const searching = q.trim().length >= 2

  return (
    <div className="min-h-dvh pb-20">
      <Header />
      <main className="mx-auto max-w-3xl px-4 pt-6 sm:px-8">
        <h1 className="display text-[2rem] leading-tight font-bold">Who said it?</h1>
        <p className="mt-1 text-ink-2">Search every line of every chapter with a script, by words or by speaker.</p>

        <label className="mt-6 flex items-center gap-2 rounded-full border-2 border-ink bg-sheet px-4 shadow-[3px_4px_0_var(--ink)]">
          <Search className="size-5 shrink-0 text-ink-2" strokeWidth={2.4} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="pirate king, Shanks, sake…"
            aria-label="Search the scripts"
            className="w-full bg-transparent py-3 text-[1.05rem] outline-none placeholder:text-ink-3"
          />
          {hits.isFetching && <Spinner className="shrink-0 text-ink-2" />}
        </label>

        {hits.isError && (
          <Bubble className="mt-10 px-6 py-4">Search isn't answering right now. Try again in a moment.</Bubble>
        )}
        {searching && hits.isSuccess && !groups.length && (
          <Bubble className="mt-10 px-6 py-4">Nobody says that, at least not in a chapter with a script.</Bubble>
        )}

        {groups.map((g) => (
          <section key={g.key} className="mt-10">
            <h2 className="display text-[1.2rem] font-semibold">
              {g.series}
              <span className="ml-2 font-normal text-ink-2">Chapter {g.chapter}</span>
            </h2>
            <ol className="mt-3 divide-y divide-rule rounded-2xl border-2 border-ink bg-sheet">
              {g.hits.map((h) => (
                <li key={`${h.page}-${h.line}`}>
                  <Link
                    to={`/read/${h.chapterId}?page=${h.page + 1}`}
                    className="flex gap-4 px-4 py-3 transition first:rounded-t-[14px] last:rounded-b-[14px] hover:bg-paper"
                  >
                    <span className="w-14 shrink-0 pt-0.5 text-[0.8rem] text-ink-3 tabular-nums">p. {h.page + 1}</span>
                    <span className="min-w-0">
                      {h.speaker && (
                        <span className="display block text-[0.85rem] font-semibold text-ink-2">
                          {h.speaker.replace(/^Unknown:\s*/, '')}
                        </span>
                      )}
                      <Snippet text={h.snippet} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
    </div>
  )
}

function group(hits: SearchHit[]) {
  const out: { key: string; series: string; chapter: string; hits: SearchHit[] }[] = []
  for (const h of hits) {
    const key = `${h.seriesId}:${h.chapterId}`
    let g = out.find((x) => x.key === key)
    if (!g) out.push((g = { key, series: h.series, chapter: h.chapter, hits: [] }))
    g.hits.push(h)
  }
  return out
}

// The service marks matches with \u0002 … \u0003 (control characters no line
// contains), so the text is never parsed as HTML.
function Snippet({ text }: { text: string }) {
  const [before, ...marked] = text.split('\u0002')
  return (
    <span className="block leading-snug">
      {before}
      {marked.map((part, i) => {
        const [match, rest = ''] = part.split('\u0003')
        return (
          <span key={i}>
            <mark className="rounded bg-kraft px-0.5 text-ink">{match}</mark>
            {rest}
          </span>
        )
      })}
    </span>
  )
}
