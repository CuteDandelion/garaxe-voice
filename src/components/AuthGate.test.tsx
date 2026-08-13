/// <reference types="vite/client" />
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'
import authGateCss from './AuthGate.css?inline'
import { isSupabaseAuthConfigured } from '../lib/supabaseAuth'

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
})

describe('AuthGate', () => {
  it('accepts local Docker Supabase over loopback HTTP', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_local')
    expect(isSupabaseAuthConfigured()).toBe(true)
  })

  it('renders an authenticated workspace', async () => {
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
  })

  it('never exposes first-owner setup through the public login gate', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: true } }) } as Response
      return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Log in to Voice Lab' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('name', 'password')
    expect(screen.queryByText(/workspace is protected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/First-run owner setup/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByText(/personal workspace and Default project are prepared automatically/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Join waitlist' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalledWith('/api/auth/bootstrap', expect.anything())
  })

  it('offers login and a persisted, consented waitlist as accessible tabs', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/auth/status'
      ? { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      : String(input) === '/api/waitlist'
        ? { ok: true, json: async () => ({ data: { status: 'recorded' } }) } as Response
        : { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response)
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)

    const tabs = await screen.findByRole('tablist', { name: 'Account access' })
    expect(screen.getByRole('link', { name: 'Voice Lab home' })).toHaveAttribute('href', '/')
    expect(within(tabs).getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Join waitlist' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Waitlist email')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /store these details/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeInTheDocument()
    expect(screen.queryByText('Request access')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Researcher Name' } })
    fireEvent.change(screen.getByLabelText('Waitlist email'), { target: { value: 'researcher@example.com' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /store these details/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Join waitlist' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/on the Voice Lab waitlist/i)
    expect(request).toHaveBeenCalledWith('/api/waitlist', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps the selected account tab readable and visually distinct', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/auth/status'
      ? { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      : { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response))
    const style = document.createElement('style')
    style.textContent = authGateCss
    document.head.append(style)

    render(<AuthGate><p>Protected research</p></AuthGate>)
    const loginTab = await screen.findByRole('tab', { name: 'Log in' })
    const waitlistTab = screen.getByRole('tab', { name: 'Join waitlist' })
    fireEvent.click(waitlistTab)

    const selectedStyle = getComputedStyle(waitlistTab)
    const unselectedStyle = getComputedStyle(loginTab)
    expect(selectedStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(selectedStyle.color).not.toBe(selectedStyle.backgroundColor)
    expect(selectedStyle.borderBottomColor).not.toBe(unselectedStyle.borderBottomColor)
    style.remove()
  })

  it('keeps the waitlist form available when storage fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/auth/status'
      ? { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      : String(input) === '/api/waitlist'
        ? { ok: false, json: async () => ({ error: { message: 'Waitlist is temporarily unavailable.' } }) } as Response
        : { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response))
    render(<AuthGate><p>Protected research</p></AuthGate>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Join waitlist' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Researcher Name' } })
    fireEvent.change(screen.getByLabelText('Waitlist email'), { target: { value: 'researcher@example.com' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /store these details/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Join waitlist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Waitlist is temporarily unavailable.')
    expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeEnabled()
  })

  it('does not send credentials to the legacy staging route when Supabase is unconfigured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)

    fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-a-staging-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Voice Lab authentication is not configured.')
    expect(request).not.toHaveBeenCalledWith('/api/auth/staging-session', expect.anything())
  })

  it('keeps the email-only development-session shortcut out of the public login form', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_LOCAL_QA_AUTH_ENABLED', 'true')
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      if (path === '/api/auth/me') return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
      return { ok: true, json: async () => ({ data: { expiresAt: '2026-08-12T00:00:00Z' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Log in to Voice Lab' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'local-test-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/auth/staging-session', expect.objectContaining({ method: 'POST' }))
    expect(request).not.toHaveBeenCalledWith('/api/auth/local-session', expect.anything())
  })

  it('uses the explicit access-key route for a staging owner', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_LOCAL_QA_AUTH_ENABLED', 'true')
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: false, stagingAccessEnabled: true } }) } as Response
      if (path === '/api/auth/me') return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
      return { ok: true, json: async () => ({ data: { expiresAt: '2026-08-12T00:00:00Z' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Log in to Voice Lab' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test-user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-generated-staging-access-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/auth/staging-session', expect.objectContaining({ method: 'POST' }))
  })

  it('uses Supabase email/password auth when the public client is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://voice-lab-test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    const requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : String(input)
      requested.push(path)
      if (path === '/api/auth/status') return Response.json({ data: { needsBootstrap: false } })
      if (path === '/api/auth/me') {
        const authorization = new Headers(init?.headers).get('authorization')
        return authorization === 'Bearer header.payload.signature'
          ? Response.json({ data: { sessionId: 'supabase-session', user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', displayName: 'Owner' }, memberships: [] } })
          : Response.json({ error: { message: 'A valid session is required.' } }, { status: 401 })
      }
      if (path.includes('/auth/v1/token?grant_type=password')) {
        return Response.json({
          access_token: 'header.payload.signature', refresh_token: 'refresh-token', token_type: 'bearer', expires_in: 3600,
          user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-08-12T00:00:00Z' },
        })
      }
      return Response.json({ error: { message: 'Unexpected request.' } }, { status: 500 })
    }))

    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Log in to Voice Lab' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(requested.some((path) => path.includes('/auth/v1/token?grant_type=password'))).toBe(true)
    expect(requested).not.toContain('/api/auth/staging-session')
  })
})
