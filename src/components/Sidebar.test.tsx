import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

const props = {
  open: true,
  projects: [{ id: 'project-1', name: 'Project', primaryDecision: 'research' }],
  projectId: 'project-1',
  activeLabel: 'Overview',
  dataset: { reviews: 0, sources: 0, confidence: null },
  account: { displayName: 'Admin', email: 'admin@example.com', role: 'owner' },
  onNavigate: vi.fn(), onProjectChange: vi.fn(), onNewProject: vi.fn(), onLogout: vi.fn(),
}

describe('Sidebar private monitoring navigation', () => {
  it('shows Waitlist only when the server-issued capability is present', () => {
    const { rerender } = render(<Sidebar {...props} waitlistMonitoring={false} />)
    expect(screen.queryByRole('button', { name: 'Waitlist' })).not.toBeInTheDocument()
    rerender(<Sidebar {...props} waitlistMonitoring />)
    expect(screen.getByRole('button', { name: 'Waitlist' })).toBeInTheDocument()
  })
})
