import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CurationWorkspace, type CurationWorkspaceProps } from './CurationWorkspace'

const handlers = () => ({
  onThemeSelect: vi.fn(), onThemeClose: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onEditStart: vi.fn(),
  onEditDraftChange: vi.fn(), onEditSave: vi.fn(), onEditCancel: vi.fn(), onEvidencePin: vi.fn(),
  onEvidenceExclude: vi.fn(), onMergeSelectionChange: vi.fn(), onMergeDraftChange: vi.fn(), onMerge: vi.fn(),
  onMergeCancel: vi.fn(), onSplitStart: vi.fn(), onSplitDraftChange: vi.fn(), onSplit: vi.fn(),
  onSplitCancel: vi.fn(), onMarkReady: vi.fn(),
})

function props(overrides: Partial<CurationWorkspaceProps> = {}): CurationWorkspaceProps {
  return {
    status: 'ready',
    run: { id: 'run-12345678', createdAt: '2026-07-12', analysisVersion: 'analysis-v1', pipelineVersion: 'pipeline-v1', totalThemes: 2, reviewedThemes: 1, requiredThemes: 2, ready: false },
    themes: [
      { id: 'theme-1', rank: 1, machine: { name: 'Setup complexity', summary: 'Customers describe difficult setup.' }, curated: null, decision: 'pending', confidence: 'high', reviewCount: 18, groupingSuggestion: { action: 'split', reason: 'Setup time and missing documentation are separate topics.' }, evidence: [{ id: 'ev-1', reviewId: 'review-1', quote: 'too long', quoteStart: 8, quoteEnd: 16, originalText: 'It took too long to set up.', entity: 'Berlin', provider: 'Google', rating: 2, sourceCreatedAt: '2026-06-01', pinned: false, excluded: false }] },
      { id: 'theme-2', rank: 2, machine: { name: 'Friendly staff', summary: 'Customers praise staff.' }, curated: { name: 'Welcoming service', summary: 'Warm service builds trust.' }, decision: 'edited', confidence: 'moderate', reviewCount: 12, evidence: [] },
    ],
    activity: [], selectedThemeId: null, editDraft: null, mergeSelection: [], mergeDraft: { name: '', summary: '' }, splitDraft: null,
    ...handlers(),
    ...overrides,
  }
}

describe('CurationWorkspace', () => {
  it('keeps selection, merge, and readiness actions controlled', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props(callbacks)} />)
    fireEvent.click(screen.getByRole('button', { name: /setup complexity/i }))
    expect(callbacks.onThemeSelect).toHaveBeenCalledWith('theme-1')
    fireEvent.click(screen.getByRole('checkbox', { name: /select setup complexity for merge/i }))
    expect(callbacks.onMergeSelectionChange).toHaveBeenCalledWith(['theme-1'])
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }))
    expect(callbacks.onMarkReady).toHaveBeenCalledOnce()
  })

  it('exposes evidence decisions and blocks readiness when gates fail', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, selectedThemeId: 'theme-1', gateErrors: ['Review every required theme.'] })} />)
    expect(screen.getByRole('dialog', { name: 'Setup complexity' })).toBeInTheDocument()
    expect(screen.getByText('too long', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'BLOCKQUOTE'
      && element.textContent === '“It took too long to set up.”')).toBeInTheDocument()
    expect(screen.getByText('Grouping check recommends a split')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pin evidence' }))
    expect(callbacks.onEvidencePin).toHaveBeenCalledWith('theme-1', 'ev-1', true)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    expect(callbacks.onEvidenceExclude).toHaveBeenCalledWith('theme-1', 'ev-1', true)
    expect(screen.getByRole('button', { name: 'Mark ready' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Review every required theme.')
  })
})
