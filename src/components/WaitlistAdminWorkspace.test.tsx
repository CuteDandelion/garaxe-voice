import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WaitlistAdminWorkspace } from './WaitlistAdminWorkspace'

describe('WaitlistAdminWorkspace', () => {
  it('shows the private count, consented signup fields, and paginates', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const secondPage = path.includes('offset=2')
      return Response.json({ data: secondPage ? {
        total: 3, limit: 2, offset: 2,
        items: [{ name: 'First person', email: 'first@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-10T10:00:00.000Z' }],
      } : {
        total: 3, limit: 2, offset: 0,
        items: [
          { name: 'Third person', email: 'third@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-12T10:00:00.000Z' },
          { name: 'Second person', email: 'second@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-11T10:00:00.000Z' },
        ],
      } })
    })
    vi.stubGlobal('fetch', request)
    render(<WaitlistAdminWorkspace pageSize={2} />)

    expect(await screen.findByRole('heading', { name: 'Waitlist monitoring' })).toBeInTheDocument()
    expect(screen.getByText('3 people')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Waitlist signups' })).toHaveTextContent('third@example.com')
    expect(screen.getByRole('table', { name: 'Waitlist signups' })).toHaveTextContent('voice-lab-waitlist-v1')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.stringContaining('offset=2'), expect.anything()))
    expect(await screen.findByText('first@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })
})
