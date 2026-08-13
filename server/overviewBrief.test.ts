import { describe, expect, it, vi } from 'vitest'
import type { EffectiveTheme } from './curation'
import type { OpenCodeGoProvider } from './llmProvider'
import { generateOverviewBrief } from './overviewBrief'

const themes = [{
  id: 'theme-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1,
  name: 'Setup friction', topic: 'setup friction', summary: 'Setup takes too long.', type: 'pain',
  signalTypes: ['pain'], categories: ['pain'], sentiment: 'negative', confidence: 'High',
  validationStatus: 'validated', status: 'approved', groupingSuggestion: null, publishable: true,
  origin: 'model_confirmed', provenance: { createdBy: null, createdAt: null, sourceReviewIds: ['review-1'] },
  evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'Setup took too long.', quoteStart: 0, quoteEnd: 20, confidence: .9, pinned: false, excluded: false }],
}] as EffectiveTheme[]

describe('overview intelligence brief', () => {
  it('keeps the brief request compact within the approved call budget', async () => {
    const provider = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({
      understood: { title: 'Setup slows adoption', narrative: 'Setup friction is the clearest signal.', themeIds: ['theme-1'] },
      majorOpportunity: null, majorRisk: null,
      salesImplications: [{ title: 'Lead with setup help', narrative: 'Show buyers how support reduces setup time.', themeIds: ['theme-1'] }],
      marketingImplications: [{ title: 'Prove a faster start', narrative: 'Use grounded setup evidence in onboarding claims.', themeIds: ['theme-1'] }],
      nextActions: [
        { title: 'Inspect setup evidence', rationale: 'Review the cited setup comments.', themeIds: ['theme-1'] },
        { title: 'Test guided onboarding', rationale: 'Validate a smaller first-run path.', themeIds: ['theme-1'] },
        { title: 'Measure setup time', rationale: 'Track whether the intervention reduces delay.', themeIds: ['theme-1'] },
      ],
    }) }) } as unknown as OpenCodeGoProvider

    await generateOverviewBrief(themes, { provider })

    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 1_800 }))
    const request = vi.mocked(provider.complete).mock.calls[0][0]
    expect(request.messages[1].content).toContain('exactly 1 sales implication, exactly 1 marketing implication, and exactly 3 next actions')
    expect(request.messages[1].content).toContain('Keep each title under 8 words and each narrative or rationale under 35 words')
    const requestedShape = JSON.parse(request.messages[1].content).output
    expect(requestedShape.salesImplications[0]).toEqual({ title: 'string', narrative: 'string', themeIds: ['supplied IDs only'] })
    expect(requestedShape.marketingImplications[0]).toEqual({ title: 'string', narrative: 'string', themeIds: ['supplied IDs only'] })
  })

  it('falls back without exposing an invalid or ungrounded completion', async () => {
    const provider = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({
      understood: { title: 'Ungrounded', narrative: 'Not tied to the saved map.', themeIds: ['invented-theme'] },
      majorOpportunity: null, majorRisk: null, salesImplications: [], marketingImplications: [], nextActions: [],
    }) }) } as unknown as OpenCodeGoProvider

    await expect(generateOverviewBrief(themes, { provider })).resolves.toEqual({
      status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null,
      message: 'The intelligence brief is unavailable. Evidence context remains available.',
    })
  })

  it('falls back when a required business implication is missing', async () => {
    const provider = { complete: vi.fn().mockResolvedValue({ content: JSON.stringify({
      understood: { title: 'Setup slows adoption', narrative: 'Setup friction is the clearest signal.', themeIds: ['theme-1'] },
      majorOpportunity: null, majorRisk: null,
      salesImplications: [],
      marketingImplications: [{ title: 'Prove a faster start', narrative: 'Use grounded setup evidence.', themeIds: ['theme-1'] }],
      nextActions: [
        { title: 'Inspect setup evidence', rationale: 'Review the cited setup comments.', themeIds: ['theme-1'] },
        { title: 'Test guided onboarding', rationale: 'Validate a smaller first-run path.', themeIds: ['theme-1'] },
        { title: 'Measure setup time', rationale: 'Track whether the intervention reduces delay.', themeIds: ['theme-1'] },
      ],
    }) }) } as unknown as OpenCodeGoProvider

    await expect(generateOverviewBrief(themes, { provider })).resolves.toMatchObject({ status: 'evidence_only', brief: null })
  })
})
