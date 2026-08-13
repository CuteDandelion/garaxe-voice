import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewInventory, type ReviewInventoryItem } from './ReviewInventory'

const maliciousReview: ReviewInventoryItem = {
  id: 'review-1', provider: 'manual_entry', entity: 'Support', rating: null, ratingScale: 5,
  title: '<script>alert(1)</script>', bodyOriginal: '<img src=x onerror=alert(1)>', language: 'en',
  sourceCreatedAt: null, sourceUrl: 'javascript:alert(1)', externalId: null,
  importJobId: 'import-1', sourceRecordId: 'source-1', importedAt: '2026-08-13T00:00:00Z',
  isRatingOnly: false, metadata: {},
}

describe('untrusted review rendering', () => {
  it('renders stored markup as text and suppresses unsafe legacy source links', () => {
    render(<ReviewInventory
      filters={{ query: '', provider: '', entity: '', rating: '', language: '', textKind: 'all' }}
      summary={{ total: 1, written: 1, ratingOnly: 0, entities: 1, providers: 1 }}
      page={{ items: [maliciousReview], nextCursor: null, previousCursor: null, rangeStart: 1, rangeEnd: 1, total: 1 }}
      providerOptions={[]} entityOptions={[]} languageOptions={[]} selectedReview={maliciousReview}
      onFiltersChange={vi.fn()} onCursorChange={vi.fn()} onSelectReview={vi.fn()} onCloseReview={vi.fn()}
    />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(dialog.querySelector('img')).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Open authorized source' })).not.toBeInTheDocument()
  })
})
