import { fireEvent, render, screen } from '@testing-library/react'
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

  it('collapses and expands the shared Demo/auth navigation accessibly', () => {
    render(<Sidebar {...props} />)
    const collapse = screen.getByRole('button', { name: 'Collapse navigation' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(screen.getByRole('complementary', { name: 'Project navigation' })).toHaveClass('is-collapsed')
    const expand = screen.getByRole('button', { name: 'Expand navigation' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(screen.getByRole('complementary', { name: 'Project navigation' })).not.toHaveClass('is-collapsed')
  })
})
