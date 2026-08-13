import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CurationWorkspace, type CurationWorkspaceProps } from './CurationWorkspace'

const handlers = () => ({
  onThemeSelect: vi.fn(), onThemeClose: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onEditStart: vi.fn(),
  onEditDraftChange: vi.fn(), onEditSave: vi.fn(), onEditCancel: vi.fn(), onEvidencePin: vi.fn(),
  onEvidenceExclude: vi.fn(), onMergeSelectionChange: vi.fn(), onMergeDraftChange: vi.fn(), onMerge: vi.fn(),
  onMergeCancel: vi.fn(), onSplitStart: vi.fn(), onSplitDraftChange: vi.fn(), onSplit: vi.fn(),
  onSplitCancel: vi.fn(), onMarkReady: vi.fn(), onApproveMany: vi.fn(),
  onCreateCustomTheme: vi.fn(), onMoveEvidence: vi.fn(), onRestoreRevision: vi.fn(),
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
  it('starts with one clear bucket-review action and keeps correction tools contextual', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, themes: [
      { ...props().themes[0], category: 'pain', sentiment: 'negative', groupingSuggestion: null },
      { ...props().themes[1], category: 'desired_outcome', sentiment: 'positive', curated: null, decision: 'pending' },
      { ...props().themes[0], id: 'theme-3', rank: 3, category: 'objection', sentiment: 'neutral', machine: { name: 'Contract hesitation', summary: 'Cancellation terms are unclear.' } },
      { ...props().themes[0], id: 'theme-4', rank: 4, category: 'emotion', sentiment: 'positive', confidence: 'weak', groupingSuggestion: null, machine: { name: 'Unclear frustration', summary: 'A weak individual signal needs review.' } },
    ] })} />)
    expect(document.querySelector('main')).toBeNull()
    expect(screen.getByRole('region', { name: 'Review one suggested bucket at a time.' })).toHaveTextContent(/Every valid comment already has a category/i)
    expect(screen.queryByText('Filter or combine suggestions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept .* clear groups/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /select .* for merge/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Review queue' })).toHaveTextContent('Contract hesitation')
    expect(screen.getByRole('region', { name: 'Review queue' })).toHaveTextContent('objection · neutral sentiment')
    expect(screen.queryByText(/run-1234|analysis-v1|pipeline-v1|engine proposal|machine proposal|machine’s findings/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review next: Setup complexity' }))
    expect(callbacks.onThemeSelect).toHaveBeenCalledWith('theme-1')
  })

  it('reveals merge only after a bucket is selected for correction', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, selectedThemeId: 'theme-1' })} />)
    expect(screen.queryByRole('checkbox', { name: /select setup complexity for merge/i })).not.toBeInTheDocument()
    const combine = screen.getByRole('button', { name: 'Combine with another bucket' })
    expect(combine.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Adjust this bucket'))
    fireEvent.click(combine)
    expect(callbacks.onMergeSelectionChange).toHaveBeenCalledWith(['theme-1'])
    expect(callbacks.onThemeClose).toHaveBeenCalledOnce()
    expect(screen.getByRole('checkbox', { name: /select welcoming service for merge/i })).toBeInTheDocument()
  })

  it('exposes evidence decisions and blocks readiness when gates fail', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, selectedThemeId: 'theme-1', gateErrors: ['Review every required theme.'] })} />)
    expect(screen.getByRole('dialog', { name: 'Setup complexity' })).toBeInTheDocument()
    expect(screen.getByText('too long', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'BLOCKQUOTE'
      && element.textContent === '“It took too long to set up.”')).toBeInTheDocument()
    expect(screen.getByText('These comments may describe more than one topic')).toBeInTheDocument()
    const primaryAction = screen.getByRole('button', { name: 'Accept this bucket' })
    expect(primaryAction).toBeEnabled()
    fireEvent.click(primaryAction)
    expect(callbacks.onApprove).toHaveBeenCalledWith('theme-1')
    fireEvent.click(screen.getByText('Adjust this bucket'))
    fireEvent.click(screen.getByRole('button', { name: 'Rename or rewrite' }))
    expect(callbacks.onEditStart).toHaveBeenCalledWith('theme-1')
    fireEvent.click(screen.getByText('Move or exclude this comment'))
    expect(screen.getByLabelText('Move evidence to')).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Choose a bucket' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pin as representative' }))
    expect(callbacks.onEvidencePin).toHaveBeenCalledWith('theme-1', 'ev-1', true)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from bucket' }))
    expect(callbacks.onEvidenceExclude).toHaveBeenCalledWith('theme-1', 'ev-1', true)
    expect(screen.queryByRole('button', { name: 'Mark ready' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Review every required theme.')
  })

  it('offers report readiness only after every required bucket is reviewed', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({
      ...callbacks,
      run: { ...props().run!, reviewedThemes: 2, requiredThemes: 2 },
      themes: props().themes.map((theme) => ({ ...theme, decision: 'approved' as const })),
    })} />)
    expect(screen.queryByRole('button', { name: /Review next:/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }))
    expect(callbacks.onMarkReady).toHaveBeenCalledOnce()
  })

  it('shows an accepted bucket as settled instead of repeating the pending action', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({
      ...callbacks,
      selectedThemeId: 'theme-1',
      themes: props().themes.map((theme) => theme.id === 'theme-1' ? { ...theme, decision: 'approved' as const } : theme),
    })} />)
    expect(screen.getByRole('dialog', { name: 'Setup complexity' })).toHaveTextContent('This bucket is accepted')
    expect(screen.queryByRole('button', { name: 'Accept this bucket' })).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting for your decision/i)).not.toBeInTheDocument()
  })

  it('explains that an edited bucket preserves the original analysis separately', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, selectedThemeId: 'theme-2' })} />)
    expect(screen.getByRole('dialog', { name: 'Welcoming service' })).toHaveTextContent('Your correction is saved separately from the original analysis')
    expect(screen.queryByRole('button', { name: 'Accept this bucket' })).not.toBeInTheDocument()
  })

  it('keeps authenticated revision restore contextual to the activity record', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({ ...callbacks, revision: 2 })} />)
    const activity = screen.getByRole('complementary', { name: 'Activity' })
    fireEvent.click(within(activity).getByRole('button', { name: 'Undo latest change' }))
    expect(callbacks.onRestoreRevision).toHaveBeenCalledWith(1)
  })

  it('keeps demo curation temporary and creates a new bucket from selected evidence', () => {
    const callbacks = handlers()
    render(<CurationWorkspace {...props({
      ...callbacks,
      demoMode: true,
      expiresAt: '2026-08-11T10:00:00.000Z',
      revision: 2,
      selectedThemeId: 'theme-1',
      themes: props().themes.map((theme) => ({ ...theme, origin: theme.id === 'theme-2' ? 'user_curated' as const : 'model_confirmed' as const })),
      coverageItems: [
        { reviewId: 'review-1', originalText: 'It took too long to set up.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['theme-1'], signals: [] },
        { reviewId: 'review-2', originalText: 'The welcome was kind.', disposition: 'emerging', reason: 'Engine-categorized individual signal.', themeIds: ['theme-2'], signals: [] },
      ],
    })} />)

    expect(screen.getByRole('status')).toHaveTextContent(/temporary demo curation/i)
    expect(screen.getByRole('region', { name: 'Complete feedback coverage' })).toHaveTextContent('2 retained comments')
    expect(screen.getByText(/Your bucket/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Move or exclude this comment'))
    fireEvent.change(screen.getByLabelText('New bucket name'), { target: { value: 'Slow setup' } })
    fireEvent.change(screen.getByLabelText('Why this comment belongs there'), { target: { value: 'A clearer team-specific grouping.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create bucket from this comment' }))
    expect(callbacks.onCreateCustomTheme).toHaveBeenCalledWith('Slow setup', 'A clearer team-specific grouping.', ['review-1'])
    fireEvent.change(screen.getByLabelText('Move evidence to'), { target: { value: 'theme-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move comment' }))
    expect(callbacks.onMoveEvidence).toHaveBeenCalledWith('theme-1', 'ev-1', 'theme-2')
    fireEvent.click(screen.getByRole('button', { name: 'Undo latest change' }))
    expect(callbacks.onRestoreRevision).toHaveBeenCalledWith(1)
  })
})
