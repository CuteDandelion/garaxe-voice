import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { getAuthStatus, getCurrentAuth, joinWaitlist, resumeStagingSession } from '../lib/api'
import { isLocalQaAuthEnabled, isSupabaseAuthConfigured, signInWithPassword, signOutSupabase } from '../lib/supabaseAuth'
import './AuthGate.css'

type AuthGateProps = {
  children: ReactNode | ((onSignedOut: () => void) => ReactNode)
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'login' | 'waitlist'>('login')
  const [waitlistState, setWaitlistState] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getAuthStatus().then(async () => {
      if (!active) return
      try {
        await getCurrentAuth()
        if (active) setState('ready')
      } catch {
        if (active) setState('signed-out')
      }
    }).catch(() => { if (active) setState('signed-out') })
    return () => { active = false }
  }, [])

  async function resume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSubmitting(true); setError(null)
    try {
      const email = String(data.get('email') || '')
      const password = String(data.get('password') || '')
      if (isSupabaseAuthConfigured()) {
        await signInWithPassword(email, password)
        try { await getCurrentAuth() }
        catch (caught) { await signOutSupabase(); throw caught }
      } else if (isLocalQaAuthEnabled()) {
        await resumeStagingSession(email, password)
      } else {
        throw new Error('Voice Lab authentication is not configured.')
      }
      setState('ready')
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Session could not be restored.') }
    finally { setSubmitting(false) }
  }

  async function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setWaitlistState('submitting'); setWaitlistError(null)
    try {
      await joinWaitlist(String(data.get('name') || ''), String(data.get('email') || ''))
      setWaitlistState('success')
    } catch (caught) {
      setWaitlistError(caught instanceof Error ? caught.message : 'Waitlist request could not be saved.')
      setWaitlistState('idle')
    }
  }

  if (state === 'ready') return typeof children === 'function' ? children(() => setState('signed-out')) : children
  if (state === 'loading') return <main className="auth-gate"><a className="auth-gate__eyebrow" href="/" aria-label="Voice Lab home">Voice Lab</a><h1>Opening your research workspace.</h1></main>
  return <main className="auth-gate"><section className="auth-gate__panel">
    <a className="auth-gate__eyebrow" href="/" aria-label="Voice Lab home">Voice Lab</a>
    <div className="auth-gate__tabs" role="tablist" aria-label="Account access">
      <button type="button" role="tab" aria-selected={activeTab === 'login'} aria-controls="auth-login-panel" onClick={() => setActiveTab('login')}>Log in</button>
      <button type="button" role="tab" aria-selected={activeTab === 'waitlist'} aria-controls="auth-waitlist-panel" onClick={() => setActiveTab('waitlist')}>Join waitlist</button>
    </div>
    {activeTab === 'login' ? <div key="login" id="auth-login-panel" role="tabpanel"><h1>Log in to Voice Lab</h1><p>Use your workspace email and password. Your personal workspace and Default project are prepared automatically on first login.</p><form onSubmit={resume}><label>Work email<input name="email" type="email" placeholder="owner@example.com" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error ? <p role="alert">{error}</p> : null}<button type="submit" disabled={submitting}>{submitting ? 'Opening workspace…' : 'Log in'}</button></form></div> : <div key="waitlist" id="auth-waitlist-panel" role="tabpanel"><h1>Join the waitlist</h1><p>Voice Lab is pre-launch. Joining the waitlist does not create an account or grant access.</p>{waitlistState === 'success' ? <p className="auth-gate__status" role="status">You’re on the Voice Lab waitlist. We’ll use these details only for launch access updates.</p> : <form onSubmit={submitWaitlist}><label>Name<input name="name" type="text" autoComplete="name" maxLength={120} required /></label><label>Waitlist email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label><label className="auth-gate__consent"><input name="consent" type="checkbox" required />Store these details for Voice Lab launch updates.</label>{waitlistError ? <p role="alert">{waitlistError}</p> : null}<button type="submit" disabled={waitlistState === 'submitting'}>{waitlistState === 'submitting' ? 'Joining…' : 'Join waitlist'}</button></form>}</div>}
  </section></main>
}
