import { createContext, lazy, Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { toTimelineAsset } from '@/lib/assets'
import { ListSource, type AssetSource } from '@/features/timeline/store'

const Viewer = lazy(() => import('./Viewer'))

interface ViewerApi {
  open: (source: AssetSource, index: number) => void
}
const Ctx = createContext<ViewerApi | null>(null)

/**
 * The viewer is an overlay over whatever screen opened it, addressed by
 * `?asset=<id>` so Back closes it and a reload reopens the single asset.
 */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ source: AssetSource; index: number } | null>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const pushed = useRef(false)
  // id we just navigated to; until the URL catches up, don't treat "no param" as Back
  const opening = useRef<string | null>(null)
  const assetParam = params.get('asset')

  const open = useCallback(
    (source: AssetSource, index: number) => {
      const a = source.assetAt(index)
      if (!a) return
      setState({ source, index })
      opening.current = a.id
      const p = new URLSearchParams(location.search)
      p.set('asset', a.id)
      pushed.current = true
      navigate({ pathname: location.pathname, search: `?${p}` })
    },
    [navigate, location.pathname, location.search],
  )

  // Back button / param removed -> close.
  useEffect(() => {
    if (assetParam && assetParam === opening.current) opening.current = null
    if (!assetParam && state && !opening.current) setState(null)
  }, [assetParam, state])

  // Deep link / reload: open the one asset on its own.
  useEffect(() => {
    if (!assetParam || state) return
    let alive = true
    api
      .asset(assetParam)
      .then((a) => alive && setState({ source: new ListSource([toTimelineAsset(a)]), index: 0 }))
      .catch(() => {
        if (!alive) return
        const p = new URLSearchParams(params)
        p.delete('asset')
        setParams(p, { replace: true })
      })
    return () => {
      alive = false
    }
  }, [assetParam, state, params, setParams])

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false
      navigate(-1)
    } else {
      const p = new URLSearchParams(params)
      p.delete('asset')
      setParams(p, { replace: true })
    }
    setState(null)
  }, [navigate, params, setParams])

  const onIndex = useCallback(
    (index: number) => {
      setState((s) => (s ? { ...s, index } : s))
      const a = state?.source.assetAt(index)
      if (a) {
        const p = new URLSearchParams(params)
        p.set('asset', a.id)
        setParams(p, { replace: true })
      }
    },
    [state, params, setParams],
  )

  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx value={value}>
      {children}
      {state && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black" />}>
          <Viewer source={state.source} index={state.index} onIndex={onIndex} onClose={close} />
        </Suspense>
      )}
    </Ctx>
  )
}

export function useViewer(): ViewerApi {
  const v = use(Ctx)
  if (!v) throw new Error('useViewer outside ViewerProvider')
  return v
}
