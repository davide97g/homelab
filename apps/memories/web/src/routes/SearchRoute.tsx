import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, Eye, Heart, Image, MapPin, Search, Sparkles, User, Video, X, type LucideIcon } from 'lucide-react'
import { api, personThumbUrl } from '@/lib/api/client'
import { ResultsGrid } from '@/features/search/ResultsGrid'
import { SectionHeader } from '@/components/Page'
import type { SentenceSearchInfo } from '@/lib/api/types'

const HEADER = 168

/** "Marci · eating · Roma · estate 2025": how the sentence was read, so a wrong guess shows. */
function Interpretation({ info, loading }: { info?: SentenceSearchInfo; loading: boolean }) {
  if (!info) {
    return (
      <p className="flex h-7 items-center gap-1 text-[13px] text-label-2">
        <Sparkles className="size-3.5" /> {loading ? 'Reading your search…' : 'Smart search'}
      </p>
    )
  }
  const chips: [string, LucideIcon][] = (info.people ?? []).map((p) => [p.replace(/\b\w/g, (c) => c.toUpperCase()), User])
  if (info.visual && !info.fallback) chips.push([info.visual, Eye])
  if (info.place) chips.push([info.place[1], MapPin])
  if (info.when) chips.push([info.when, Calendar])
  if (info.media === 'video') chips.push(['Videos', Video])
  if (info.media === 'photo') chips.push(['Photos', Image])
  if (info.favorite) chips.push(['Favorites', Heart])
  const missing = info.missingPeople ?? []
  const note = missing.length
    ? `No one named ${missing.map((n) => `“${n}”`).join(', ')} yet: name their face in People and search again.`
    : info.fallback
      ? 'Searched for the words as typed (the language model didn’t answer).'
      : ''
  return (
    <>
      <div className="no-scrollbar -mx-4 flex h-7 gap-1.5 overflow-x-auto px-4">
        {chips.map(([label, Icon]) => (
          <span key={label} className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-fill px-2.5 text-[12px] font-medium">
            <Icon className="size-3.5 text-accent" /> {label}
          </span>
        ))}
      </div>
      {note && <p className="mt-1.5 truncate text-[12px] text-label-2">{note}</p>}
    </>
  )
}

const CATEGORIES = ['Beach', 'Mountains', 'Sunset', 'Snow', 'Food', 'Dogs', 'Cats', 'Cars', 'Concert', 'Birthday cake', 'Flowers', 'Night city', 'Documents', 'Hiking']

export default function SearchRoute() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const [text, setText] = useState(q)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setText(q), [q])
  useEffect(() => {
    if (!q && !params.get('asset')) inputRef.current?.focus({ preventScroll: true })
    // focus on first mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const people = useQuery({ queryKey: ['people'], queryFn: () => api.people(), enabled: !q })
  const cities = useQuery({ queryKey: ['suggestions', 'city'], queryFn: () => api.suggestions('city'), enabled: !q })
  const submit = (v: string) => {
    const s = v.trim()
    if (!s) return
    setParams({ q: s })
    inputRef.current?.blur()
  }

  return (
    <div className="fixed inset-0 bg-bg">
      {q ? (
        <ResultsGrid
          key={q}
          queryKey={['sentence', q]}
          fetchPage={(page) => api.sentenceSearch(q, page ? Number(page) : undefined)}
          topInset={HEADER}
          bottomInset={120}
          emptyText="No results"
          header={(first) => (
            <div className="flex flex-col justify-end px-4 pb-3" style={{ height: HEADER }}>
              <h1 className="large-title truncate pb-2">{q}</h1>
              <Interpretation info={first?.memories} loading={!first} />
            </div>
          )}
        />
      ) : (
        <div className="absolute inset-0 overflow-y-auto">
          <div className="mx-auto max-w-[1000px] pb-40" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
            <h1 className="large-title px-4 pb-1">Search</h1>
            {(people.data?.people ?? []).some((p) => p.name) && (
              <>
                <SectionHeader title="People" to="/people" />
                <div className="no-scrollbar flex gap-4 overflow-x-auto px-4">
                  {people.data!.people
                    .filter((p) => p.name && !p.isHidden)
                    .slice(0, 16)
                    .map((p) => (
                      <Link key={p.id} to={`/people/${p.id}`} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
                        <img src={personThumbUrl(p.id, p.updatedAt)} alt="" className="size-[72px] rounded-full bg-placeholder object-cover" />
                        <span className="w-full truncate text-center text-[12px] font-medium">{p.name}</span>
                      </Link>
                    ))}
                </div>
              </>
            )}
            {(cities.data?.length ?? 0) > 0 && (
              <>
                <SectionHeader title="Places" to="/places" />
                <div className="flex flex-wrap gap-2 px-4">
                  {cities.data!.slice(0, 18).map((c) => (
                    <Link key={c} to={`/places/${encodeURIComponent(c)}`} className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[15px]">
                      <MapPin className="size-4 text-accent" /> {c}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <SectionHeader title="Categories" />
            <div className="flex flex-wrap gap-2 px-4">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => submit(c)} className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[15px]">
                  <Sparkles className="size-4 text-accent" /> {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom glass search field (iOS 26 search tab) */}
      <form
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-3 px-4"
        style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <label className="glass flex h-[54px] w-full max-w-[560px] items-center gap-2 rounded-full px-4">
          <Search className="size-5 shrink-0 text-label-2" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Places, people, things…"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-label-2"
          />
          {text && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setText('')
                setParams({})
                inputRef.current?.focus()
              }}
              className="flex size-6 items-center justify-center rounded-full bg-label-3 text-bg"
            >
              <X className="size-3.5" strokeWidth={3} />
            </button>
          )}
        </label>
        <button type="button" aria-label="Close search" onClick={() => navigate('/')} className="glass flex size-[54px] shrink-0 items-center justify-center rounded-full">
          <X className="size-6" />
        </button>
      </form>
    </div>
  )
}
