import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useCallback } from 'react'
import { EmailCode } from '@/components/EmailCode.tsx'
import { PasskeySignIn } from '@/components/PasskeySignIn.tsx'
import { SocialButtons } from '@/components/SocialButtons.tsx'
import { Shell } from '@/components/ui.tsx'
import { safeNext } from '@/lib/api.ts'
import { useSession } from '@/lib/session.tsx'

export function Login() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { status, refresh } = useSession()
  const navigate = useNavigate()

  const go = useCallback(() => {
    if (next && new URL(next).origin !== location.origin) location.assign(next)
    else navigate(next ? new URL(next).pathname + new URL(next).search : '/', { replace: true })
  }, [next, navigate])
  const signedIn = useCallback(async () => {
    await refresh()
    go()
  }, [refresh, go])

  if (status === 'in' && next) {
    go()
    return null
  }
  if (status === 'in') return <Navigate to="/" replace />

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-bold">Accedi</h1>
      <p className="mb-8 text-sm text-muted">Un account per Cinema, Memories e il resto di casa.</p>
      <PasskeySignIn onDone={signedIn} />
      <SocialButtons next={next} />
      <EmailCode onDone={signedIn} />
    </Shell>
  )
}
