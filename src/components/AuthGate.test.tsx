import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

describe('AuthGate', () => {
  it('renders an authenticated workspace', async () => {
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
  })

  it('creates the one-time owner before revealing the workspace', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const data = path === '/api/auth/status' ? { needsBootstrap: true } : { userId: 'user-1', organizationId: 'org-1' }
      return { ok: true, json: async () => ({ data }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Give this research workspace an owner.' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create protected workspace' }))
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/auth/bootstrap', expect.objectContaining({ method: 'POST' }))
  })

  it('restores a loopback development session for an existing owner', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: false } }) } as Response
      if (path === '/api/auth/me') return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
      return { ok: true, json: async () => ({ data: { expiresAt: '2026-08-12T00:00:00Z' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByRole('heading', { name: 'Your workspace is protected.' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resume local workspace' }))
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/auth/local-session', expect.objectContaining({ method: 'POST' }))
  })

  it('uses the explicit access-key route for a staging owner', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/status') return { ok: true, json: async () => ({ data: { needsBootstrap: false, stagingAccessEnabled: true } }) } as Response
      if (path === '/api/auth/me') return { ok: false, json: async () => ({ error: { message: 'A valid session is required.' } }) } as Response
      return { ok: true, json: async () => ({ data: { expiresAt: '2026-08-12T00:00:00Z' } }) } as Response
    })
    vi.stubGlobal('fetch', request)
    render(<AuthGate><p>Protected research</p></AuthGate>)
    expect(await screen.findByText('Staging access required')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: 'test-user@example.com' } })
    fireEvent.change(screen.getByLabelText('Staging access key'), { target: { value: 'a-generated-staging-access-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open staging workspace' }))
    expect(await screen.findByText('Protected research')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/auth/staging-session', expect.objectContaining({ method: 'POST' }))
  })
})
