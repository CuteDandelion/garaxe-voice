import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { bootstrapOwner, getAuthStatus, getCurrentAuth, resumeLocalSession, resumeStagingSession } from '../lib/api'
import './AuthGate.css'

type AuthGateProps = {
  children: ReactNode | ((onSignedOut: () => void) => ReactNode)
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'bootstrap' | 'signed-out'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [stagingAccessEnabled, setStagingAccessEnabled] = useState(false)

  useEffect(() => {
    let active = true
    void getAuthStatus().then(async ({ needsBootstrap, stagingAccessEnabled: staging }) => {
      if (!active) return
      setStagingAccessEnabled(Boolean(staging))
      if (needsBootstrap) return setState('bootstrap')
      try {
        await getCurrentAuth()
        if (active) setState('ready')
      } catch {
        if (active) setState('signed-out')
      }
    }).catch(() => { if (active) setState('signed-out') })
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(null)
    try {
      await bootstrapOwner({
        displayName: String(data.get('displayName') || ''),
        email: String(data.get('email') || ''),
        organizationName: String(data.get('organizationName') || ''),
      })
      setState('ready')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Owner setup failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function resume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSubmitting(true); setError(null)
    try {
      const email = String(data.get('email') || '')
      if (stagingAccessEnabled) await resumeStagingSession(email, String(data.get('accessKey') || ''))
      else await resumeLocalSession(email)
      setState('ready')
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Session could not be restored.') }
    finally { setSubmitting(false) }
  }

  if (state === 'ready') return typeof children === 'function' ? children(() => setState('signed-out')) : children
  if (state === 'loading') return <main className="auth-gate"><p className="auth-gate__eyebrow">Garaxe Voice Intelligence</p><h1>Opening your research workspace.</h1></main>
  if (state === 'signed-out') return <main className="auth-gate"><section className="auth-gate__panel"><p className="auth-gate__eyebrow">{stagingAccessEnabled ? 'Staging access required' : 'Local session required'}</p><h1>Your workspace is protected.</h1><p>{stagingAccessEnabled ? 'Use the staging owner email and access key. Paid beta will replace this gate with the configured identity provider.' : 'Resume an existing owner session on this local machine. Production uses the configured identity provider; this route is unavailable there.'}</p><form onSubmit={resume}><label>Owner email<input name="email" type="email" placeholder="owner@example.com" required /></label>{stagingAccessEnabled ? <label>Staging access key<input name="accessKey" type="password" autoComplete="current-password" required /></label> : null}{error ? <p role="alert">{error}</p> : null}<button type="submit" disabled={submitting}>{submitting ? 'Opening workspace…' : stagingAccessEnabled ? 'Open staging workspace' : 'Resume local workspace'}</button></form></section></main>

  return <main className="auth-gate">
    <section className="auth-gate__panel">
      <p className="auth-gate__eyebrow">First-run owner setup</p>
      <h1>Give this research workspace an owner.</h1>
      <p>This one-time step creates the first organization and closes public bootstrap access.</p>
      <form onSubmit={submit}>
        <label>Organization<input name="organizationName" defaultValue="Acme Software" required /></label>
        <label>Your name<input name="displayName" defaultValue="Alex Rivera" required /></label>
        <label>Work email<input name="email" type="email" placeholder="alex@example.com" required /></label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? 'Creating owner…' : 'Create protected workspace'}</button>
      </form>
    </section>
  </main>
}
