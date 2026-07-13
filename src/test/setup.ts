import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Set before test modules lazily initialize the shared server database. This
// prevents integration tests from truncating or rewriting local developer data.
process.env.GARAXE_DB_DIR = 'memory://'

beforeEach(() => {
  if (typeof window === 'undefined') return
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {}
    let data: unknown = null
    if (path === '/api/auth/status') {
      data = { needsBootstrap: false }
    } else if (path === '/api/auth/me') {
      data = { sessionId: 'session-1', user: { id: 'user-1', email: 'owner@example.com', displayName: 'Alex Rivera' }, memberships: [{ organizationId: 'org-1', organizationName: 'Acme Software', role: 'owner' }] }
    } else if (path === '/api/auth/logout') {
      data = { signedOut: true }
    } else if (path === '/api/projects' && init?.method === 'POST') {
      data = { id: requestBody.name === 'Acme Software' ? '11111111-1111-4111-8111-111111111111' : '55555555-5555-4555-8555-555555555555', name: requestBody.name, primaryDecision: requestBody.primaryDecision }
    } else if (path === '/api/projects') {
      data = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Acme Software', primaryDecision: 'positioning' }]
    } else if (path === '/api/imports') {
      data = { id: '22222222-2222-4222-8222-222222222222', status: 'queued', totalRows: 7 }
    } else if (path.startsWith('/api/imports/')) {
      data = { id: '22222222-2222-4222-8222-222222222222', projectId: '11111111-1111-4111-8111-111111111111', fileName: 'reviews.csv', status: 'completed', totalRows: 7, processedRows: 7, usableRows: 5, writtenRows: 4, ratingOnlyRows: 1, duplicateRows: 1, invalidRows: 1, errorMessage: null }
    } else if (path === '/api/analysis-runs' && init?.method === 'POST') {
      data = { id: '33333333-3333-4333-8333-333333333333', projectId: '11111111-1111-4111-8111-111111111111', objective: 'full_voice_map', configuration: requestBody.configuration, status: 'queued', stage: 'queued', pipelineVersion: 'analysis-dataset-v1' }
    } else if (path === '/api/analysis-runs/33333333-3333-4333-8333-333333333333') {
      data = { id: '33333333-3333-4333-8333-333333333333', projectId: '11111111-1111-4111-8111-111111111111', objective: 'full_voice_map', configuration: {}, status: 'completed', stage: 'completed', pipelineVersion: 'analysis-dataset-v1', counts: { found: 5, included: 4, excluded: 1 }, qualityReport: { preprocessingVersion: 'deterministic-preprocessing-v1', found: 5, included: 4, excluded: 1, exclusionReasons: { rating_only: 1 }, written: 4, ratingOnly: 1, languageDistribution: { en: 4, de: 1 }, averageTextLength: 48, medianTextLength: 51, duplicateGroupCount: 0, confidence: 'insufficient' }, errorMessage: null, createdAt: '2026-07-12T00:00:00Z', startedAt: '2026-07-12T00:00:00Z', completedAt: '2026-07-12T00:00:01Z' }
    } else if (path.startsWith('/api/analysis-runs/33333333-3333-4333-8333-333333333333/reviews')) {
      data = [{ reviewId: 'review-1', inclusionStatus: 'included', exclusionReason: null, normalizedText: 'great service', preprocessingVersion: 'deterministic-preprocessing-v1', originalText: 'Great service', ratingValue: 5, language: 'en', entityName: 'Acme' }]
    } else if (path.includes('/projects/') && path.endsWith('/analysis-runs')) {
      data = [{ id: '33333333-3333-4333-8333-333333333333', projectId: '11111111-1111-4111-8111-111111111111', objective: 'full_voice_map', configuration: {}, status: 'completed', stage: 'completed', pipelineVersion: 'semantic-voice-map-v4', counts: { found: 5, included: 4, excluded: 1 }, qualityReport: { confidence: 'emerging' }, errorMessage: null, createdAt: '2026-07-12T00:00:00Z', startedAt: null, completedAt: '2026-07-12T00:00:01Z' }]
    } else if (path === '/api/analysis-runs/33333333-3333-4333-8333-333333333333/curation-sessions') {
      data = { session: { id: 'curation-1', analysisRunId: '33333333-3333-4333-8333-333333333333', status: 'in_progress', revision: 0, createdAt: '2026-07-12T00:00:02Z', readyAt: null }, created: true }
    } else if (path === '/api/analysis-runs/33333333-3333-4333-8333-333333333333/curation') {
      const theme = { id: 'theme-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1, name: 'Setup complexity', summary: 'Two reviews mention setup complexity.', type: 'pain_point', sentiment: 'negative', confidence: 'Emerging', validationStatus: 'validated', status: 'pending', evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'The setup took days', quoteStart: 0, quoteEnd: 19, confidence: 0.9, pinned: false, excluded: false }], publishable: false }
      data = { session: null, machineThemes: [theme], effectiveThemes: [theme], actions: [], readiness: { validatedMachineThemes: 1, resolved: 0, pending: 1, approved: 0, rejected: 0, consumed: 0, publishable: 0, canMarkReady: false, isReady: false } }
    } else if (path === '/api/projects/11111111-1111-4111-8111-111111111111/reports') {
      data = [{ id: '44444444-4444-4444-8444-444444444444', projectId: '11111111-1111-4111-8111-111111111111', analysisRunId: '33333333-3333-4333-8333-333333333333', curationSessionId: 'curation-1', curationRevision: 3, version: 1, title: 'Acme Voice Map', generatedAt: '2026-07-12T00:00:03Z' }]
    } else if (path === '/api/reports/44444444-4444-4444-8444-444444444444') {
      data = { id: '44444444-4444-4444-8444-444444444444', projectId: '11111111-1111-4111-8111-111111111111', analysisRunId: '33333333-3333-4333-8333-333333333333', curationSessionId: 'curation-1', curationRevision: 3, version: 1, title: 'Acme Voice Map', generatedAt: '2026-07-12T00:00:03Z', snapshot: { schemaVersion: 'report-snapshot-v1', generatedAt: '2026-07-12T00:00:03Z', analysisRun: { id: '33333333-3333-4333-8333-333333333333' }, curation: { sessionId: 'curation-1', revision: 3, readyAt: '2026-07-12T00:00:02Z' }, versions: { pipeline: 'deterministic-voice-map-v1', synthesis: 'deterministic-theme-engine-v1', report: 'report-snapshot-v1' }, dataset: { counts: { found: 5, included: 4, excluded: 1 }, qualityReport: { found: 5, included: 4, excluded: 1, written: 4, ratingOnly: 1, confidence: 'emerging' } }, narrative: { headline: 'Setup complexity', executiveSummary: 'Customers want a simpler setup.', signals: [] }, themes: [{ id: 'theme-1', rank: 1, name: 'Setup complexity', summary: 'Customers want a simpler setup.', type: 'pain_point', sentiment: 'negative', confidence: 'Emerging', evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'The setup took days', provider: 'csv_import', entity: 'Acme', rating: 2, pinned: true }] }] } }
    } else if (path === '/api/analysis-runs/33333333-3333-4333-8333-333333333333/voice-map') {
      data = { run: { id: '33333333-3333-4333-8333-333333333333', projectId: '11111111-1111-4111-8111-111111111111', objective: 'full_voice_map', configuration: {}, status: 'completed', stage: 'completed', pipelineVersion: 'semantic-voice-map-v5', counts: { included: 4 }, qualityReport: { confidence: 'emerging' }, errorMessage: null, createdAt: '2026-07-12T00:00:00Z', startedAt: null, completedAt: '2026-07-12T00:00:01Z' }, synthesisVersion: 'llm-interpreted-theme-engine-v1', artifact: { validationThreshold: 1, voiceMap: { engineVersion: 'llm-interpreted-theme-engine-v1', executiveConclusion: { title: 'Setup complexity shapes the need for easier use.', narrative: 'Linked validated themes support this conclusion.', supportingThemeIds: ['theme-1'], evidenceReviewCount: 4, confidence: 'Emerging' }, primaryPain: { title: 'Setup complexity', narrative: 'Customers describe configuration friction.', supportingThemeIds: ['theme-1'], evidenceReviewCount: 2, confidence: 'Emerging' }, desiredOutcome: null, mainObjection: null, emotionalDriver: null, journeyStages: [], customerPhrases: [{ signalId: 'signal-1', reviewId: 'review-1', quoteText: 'The setup took days', confidence: 0.9 }], recommendedMoves: [{ function: 'Operations', recommendation: 'Address setup complexity.', supportingThemeIds: ['theme-1'], evidenceReviewCount: 2 }] } }, themes: [{ id: 'theme-1', rank: 1, name: 'Setup complexity', summary: 'Two reviews mention setup complexity.', type: 'pain_point', sentiment: 'negative', confidence: 'Emerging', metrics: { signalCount: 2, independentReviewCount: 2, prevalence: 0.5, averageRating: 2, contradictionRatio: 0, entityBreakdown: [{ value: 'Acme', count: 2 }], languageBreakdown: [{ value: 'en', count: 2 }] }, validation: { status: 'validated', repeatedPhrases: [{ text: 'setup took', count: 2 }], interpretationCandidate: { label: 'Setup complexity', aspect: 'setup', evaluation: 'pain', signalTypes: ['pain', 'objection', 'emotion'], rootCause: 'The setup took days.', consequence: 'Customers need support before they can start.', confidence: 0.9, publicationAction: 'publish', publicationReason: null, groupingAction: 'keep', groupingReason: null, provider: 'opencode_go', model: 'test-model', promptVersion: 'root-cause-first-v9-publication-gate', schemaVersion: 'cluster-interpretation-v5' } }, evidence: [{ id: 'signal-1', reviewId: 'review-1', quote: 'The setup took days', quoteStart: 0, quoteEnd: 19, originalText: 'The setup took days, and support never replied.', rating: 2, provider: 'csv_import', entity: 'Acme', language: 'en', sourceCreatedAt: '2026-07-01T00:00:00Z', sourceUrl: null, strength: 0.9, isRepresentative: true }] }] }
    } else if (path.includes('/review-summary')) {
      data = { total: 5, writtenCount: 4, ratingOnlyCount: 1, providerCount: 1, entityCount: 1, earliestDate: '2026-01-01T00:00:00Z', latestDate: '2026-07-01T00:00:00Z', averageRating: 4, breakdowns: { providers: [{ value: 'csv_import', count: 5 }], entities: [{ value: 'Acme', count: 5 }], ratings: [{ value: 5, count: 3 }], languages: [{ value: 'en', count: 5 }] } }
    } else if (path === '/api/reviews/review-1') {
      data = { review: { id: 'review-1', externalReviewId: 'external-review-1', provider: 'csv_import', entityName: 'Acme', ratingValue: 2, ratingScale: 5, title: null, body: 'The setup took days', language: 'en', reviewerName: null, ownerReply: null, sourceUrl: null, sourceCreatedAt: '2026-07-01T00:00:00Z', isRatingOnly: false, importedAt: '2026-07-02T00:00:00Z', metadata: {} }, sourceRecord: { id: 'source-record-1', rowNumber: 1, rawPayload: { review_text: 'The setup took days' }, payloadHash: 'payload-hash-1', importedAt: '2026-07-02T00:00:00Z' }, importJob: { id: 'import-job-1', fileName: 'reviews.csv', status: 'completed', createdAt: '2026-07-02T00:00:00Z' } }
    } else if (path.includes('/reviews')) {
      data = { items: [], nextCursor: null, hasMore: false }
    }
    return { ok: true, json: async () => ({ data }) } as Response
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
