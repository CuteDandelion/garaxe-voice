import { describe, expect, it } from 'vitest'
import type { EffectiveTheme } from './curation'
import type { OpenCodeGoProvider } from './llmProvider'
import { generateReportNarrative } from './reportNarrative'

const theme = (overrides: Partial<EffectiveTheme> = {}): EffectiveTheme => ({
  id: 'theme-1', machineThemeId: 'machine-1', originThemeIds: ['machine-1'], rank: 1,
  name: 'Checkout delays', summary: 'Customers abandon checkout when confirmation stalls.',
  type: 'pain', sentiment: 'negative', confidence: 'high', validationStatus: 'validated', status: 'approved',
  groupingSuggestion: null, publishable: true,
  evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'checkout froze', quoteStart: 4, quoteEnd: 19,
    originalText: 'The checkout froze before confirmation.', entity: 'Shop', provider: 'upload', rating: 2,
    sourceCreatedAt: '2026-01-01', confidence: 0.9, pinned: true, excluded: false }],
  ...overrides,
})

describe('report narrative synthesis', () => {
  it('uses a concise non-reasoning LLM request and preserves only valid theme citations', async () => {
    let request: Record<string, unknown> | null = null
    const provider = { complete: async (input: Record<string, unknown>) => {
      request = input
      return { provider: 'opencode_go', model: 'fast-model', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, requestId: 'req-1', content: JSON.stringify({
        headline: 'Checkout friction is costing completed orders', executiveSummary: 'Customers report confirmation delays that interrupt purchase completion.',
        opportunities: ['Shorten the confirmation path'], risks: ['Continued abandonment'],
        actions: [{ priority: 'now', title: 'Instrument confirmation latency', rationale: 'The approved delay theme connects freezes to abandonment.', themeIds: ['theme-1', 'invented'], successMeasure: 'Reduce p95 confirmation latency and related complaints.' }],
      }) }
    } } as unknown as OpenCodeGoProvider
    const result = await generateReportNarrative({ projectName: 'Shop', objective: 'full_voice_map', themes: [theme()] }, { provider, environment: { OPENCODE_GO_DEFAULT_MODEL: 'fast-model' }, generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(result.provenance).toMatchObject({ generator: 'llm', model: 'fast-model' })
    expect(result.actions[0].themeIds).toEqual(['theme-1'])
    expect(request).toMatchObject({ maxTokens: 1200, temperature: 0, json: true, enableThinking: false })
  })

  it('falls back to approved interpretations when the provider is unavailable', async () => {
    const result = await generateReportNarrative({ projectName: 'Shop', objective: 'full_voice_map', themes: [theme()] }, { provider: null, generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(result.provenance.generator).toBe('curated_interpretations')
    expect(result.actions[0].themeIds).toEqual(['theme-1'])
  })
})
