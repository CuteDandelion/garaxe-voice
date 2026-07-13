import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReportsWorkspace, type ReportsWorkspaceProps } from './ReportsWorkspace'

function handlers() {
  return { onCreateTitleChange: vi.fn(), onCreate: vi.fn(), onSelect: vi.fn(), onDownload: vi.fn() }
}

function props(overrides: Partial<ReportsWorkspaceProps> = {}): ReportsWorkspaceProps {
  return {
    status: 'ready',
    reports: [
      { id: 'report-2', title: 'July Voice Map', revision: 2, generatedAt: '2026-07-12T12:00:00Z', sourceRunId: 'run-12345678', curationRevision: 7 },
      { id: 'report-1', title: 'June Voice Map', revision: 1, generatedAt: '2026-06-12T12:00:00Z', sourceRunId: 'run-87654321', curationRevision: 4 },
    ],
    selectedReport: {
      id: 'report-2', title: 'July Voice Map', revision: 2, generatedAt: '2026-07-12T12:00:00Z', sourceRunId: 'run-12345678', curationRevision: 7, readiness: 'ready',
      conclusion: 'Customers are buying relief from complexity.', interpretation: 'Repeated language centers on setup fatigue and confidence that the service will work.',
      dataset: { found: 200, included: 184, excluded: 16, written: 190, ratingOnly: 10, sourceCount: 3, confidence: 'High' },
      themes: [{ id: 'theme-1', rank: 1, name: 'Configuration fatigue', summary: 'Customers describe setup as a cognitive burden.', reviewCount: 42, evidence: [{ id: 'evidence-1', quote: 'I just wanted it to work.', provider: 'Google', entity: 'Berlin', rating: 5 }] }],
    },
    createTitle: 'August Voice Map',
    ...handlers(),
    ...overrides,
  }
}

describe('ReportsWorkspace', () => {
  it('keeps creation, selection, and download actions controlled', () => {
    const callbacks = handlers()
    render(<ReportsWorkspace {...props(callbacks)} />)
    fireEvent.change(screen.getByLabelText('New immutable report'), { target: { value: 'Quarterly Voice Map' } })
    expect(callbacks.onCreateTitleChange).toHaveBeenCalledWith('Quarterly Voice Map')
    fireEvent.click(screen.getByRole('button', { name: 'Create report' }))
    expect(callbacks.onCreate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('June Voice Map').closest('button')!)
    expect(callbacks.onSelect).toHaveBeenCalledWith('report-1')
    fireEvent.click(screen.getByRole('button', { name: 'Download July Voice Map PDF' }))
    expect(callbacks.onDownload).toHaveBeenCalledWith('report-2')
  })

  it('renders provenance, curated evidence, and immutable state', () => {
    render(<ReportsWorkspace {...props()} />)
    expect(screen.getByText('Immutable snapshot')).toBeInTheDocument()
    expect(screen.getByText('Customers are buying relief from complexity.')).toBeInTheDocument()
    expect(screen.getByText('“I just wanted it to work.”')).toBeInTheDocument()
    expect(screen.getByLabelText('Report provenance')).toHaveTextContent('run-12345678')
    expect(screen.getByLabelText('Snapshot dataset summary')).toHaveTextContent('184')
  })

  it('shows an honest empty state and blocks creation before readiness', () => {
    const callbacks = handlers()
    render(<ReportsWorkspace {...props({ ...callbacks, status: 'empty', reports: [], selectedReport: null, canCreate: false })} />)
    expect(screen.getByRole('heading', { name: 'Publish the first immutable Voice Map.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create report' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Mark the curation run ready')
  })
})
