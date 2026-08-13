import { describe, expect, it } from 'vitest'
import type { CurationProjection } from '../lib/api'
import { adaptActivity, adaptThemes } from './CurationWorkspaceContainer'

describe('adaptThemes', () => {
  it('uses the customer-facing Elseform brand in Curation history', () => {
    const projection = {
      effectiveThemes: [{ id: 'theme-1', name: 'Clearer setup' }],
      actions: [{ id: 'action-1', createdAt: '2026-08-13', actionType: 'edit_theme', payload: { themeId: 'theme-1' } }],
    } as unknown as CurationProjection

    expect(adaptActivity(projection)[0]).toMatchObject({ actorName: 'Elseform Analyst', themeName: 'Clearer setup' })
  })

  it('counts the effective evidence after a Curation move', () => {
    const effective = {
      id: 'theme-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1,
      name: 'Moved evidence', summary: 'One comment remains.', type: 'pain', categories: ['pain'], sentiment: 'negative',
      confidence: 'emerging', validationStatus: 'valid', status: 'pending' as const, groupingSuggestion: null,
      publishable: false, origin: 'user_curated' as const, provenance: { createdBy: 'user-1', createdAt: '2026-08-13', sourceReviewIds: ['review-1'] },
      evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'quote', quoteStart: 0, quoteEnd: 5, originalText: 'quote', entity: null, provider: 'CSV', rating: null, sourceCreatedAt: null, confidence: .8, pinned: false, excluded: false }],
    } satisfies CurationProjection['effectiveThemes'][number]
    const projection = {
      session: { id: 'session-1', analysisRunId: 'run-1', status: 'in_progress' as const, revision: 1, createdAt: '2026-08-13', readyAt: null },
      machineThemes: [{ ...effective, origin: 'model_confirmed' as const, evidence: [...effective.evidence, { ...effective.evidence[0], signalId: 'signal-2', reviewId: 'review-2' }] }],
      effectiveThemes: [effective], actions: [],
      readiness: { validatedMachineThemes: 1, resolved: 0, pending: 1, approved: 0, rejected: 0, consumed: 0, publishable: 0, canMarkReady: false, isReady: false },
    } satisfies CurationProjection
    const artifact = { themes: [{ id: 'theme-1', metrics: { independentReviewCount: 2 } }] } as unknown as Parameters<typeof adaptThemes>[1]

    expect(adaptThemes(projection, artifact)[0]?.reviewCount).toBe(1)
  })

  it('does not leak a superseded historical edit into the restored effective revision', () => {
    const theme: CurationProjection['machineThemes'][number] = {
      id: 'theme-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1,
      name: 'Account pass location missing', summary: 'Two ticket transfers share one concern.',
      type: 'emotion', categories: ['emotion'], sentiment: 'neutral', confidence: 'emerging', validationStatus: 'valid',
      status: 'approved' as const, evidence: [], groupingSuggestion: null, publishable: true,
      origin: 'model_confirmed' as const, provenance: { createdBy: null, createdAt: null, sourceReviewIds: [] },
    }
    const projection = {
      session: { id: 'session-1', analysisRunId: 'run-1', status: 'in_progress' as const, revision: 1, createdAt: '2026-08-12T00:00:00Z', readyAt: null },
      machineThemes: [theme], effectiveThemes: [theme],
      actions: [{ id: 'action-1', sessionId: 'session-1', analysisRunId: 'run-1', sequence: 2, actionType: 'edit_theme' as const, payload: { themeId: 'theme-1', name: 'Superseded name' }, createdAt: '2026-08-12T00:01:00Z' }],
      readiness: { validatedMachineThemes: 1, resolved: 1, pending: 0, approved: 1, rejected: 0, consumed: 0, publishable: 1, canMarkReady: true, isReady: false },
    } satisfies CurationProjection

    expect(adaptThemes(projection, null)[0]).toMatchObject({ decision: 'approved', curated: null })
  })
})
