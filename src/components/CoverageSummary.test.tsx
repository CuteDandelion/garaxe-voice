import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoverageSummary } from './CoverageSummary'

describe('CoverageSummary', () => {
  it('traces every authenticated-workspace comment without demo retention copy', () => {
    const onThemeSelect = vi.fn()
    render(<CoverageSummary items={[
      { reviewId: 'review-1', originalText: 'Clear milestones made the process easy.', disposition: 'recurring', reason: 'Engine-categorized feedback supports a validated recurring signal.', themeIds: ['theme-1'] },
      { reviewId: 'review-2', originalText: 'The account choice was confusing.', disposition: 'emerging', reason: 'Engine-categorized individual signal; recurrence is not yet confirmed.', themeIds: [], signals: [{ label: 'Regional policy wording', topic: 'regional policy', signalType: 'other', category: 'other', sentiment: 'neutral', confidence: .49, quote: 'account choice was confusing', interpretedBy: 'analysis_engine' }] },
    ]} onThemeSelect={onThemeSelect} />)

    const coverage = screen.getByRole('region', { name: 'Feedback coverage' })
    expect(screen.getByRole('heading', { name: 'Every submitted comment is accounted for.' })).toBeInTheDocument()
    expect(coverage).toHaveTextContent('2 comments accounted for')
    expect(coverage).not.toHaveTextContent(/temporary|expires/i)
    expect(coverage).not.toHaveTextContent(/disposition|engine-categorized|deterministic extraction/i)
    expect(screen.getByRole('region', { name: 'Emerging signals' })).toHaveTextContent('49% confidence')
    expect(screen.getByRole('region', { name: 'Emerging signals' })).toHaveTextContent('has a category and full-colour bubble')
    expect(screen.getByRole('region', { name: 'Emerging signals' })).toHaveTextContent('Recurrence is communicated by feedback count and bubble size')
    expect(screen.getByRole('region', { name: 'Emerging signals' })).toHaveTextContent('other · neutral sentiment · regional policy')
    fireEvent.click(screen.getByRole('button', { name: 'Open linked theme' }))
    expect(onThemeSelect).toHaveBeenCalledWith('theme-1')
  })
})
