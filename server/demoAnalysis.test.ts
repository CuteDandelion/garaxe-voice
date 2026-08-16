// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDatabase, resetDatabaseForTests } from './db'
import {
  actionableCategory,
  actionableCategories,
  appendDemoAnalysisSessionCsv,
  cleanupExpiredDemoAnalysisSessions,
  createDemoAnalysisSession,
  DEMO_RETENTION_MS,
  DemoAnalysisError,
  demoRunUsesOpenCode,
  dominantCoverageSignals,
  getAnalysisCoverage,
  getDemoAnalysisSession,
  isPublishableDemoTheme,
} from './demoAnalysis'
import { loadEmergingSignalWork } from './clusterInterpretation'
import { detectMapping, parseCsv, rowsToCsv } from '../src/lib/csv'

describe('retained feedback actionable taxonomy', () => {
  it('keeps semantic category separate from recurrence and preserves out-of-taxonomy feedback honestly', () => {
    expect(['pain', 'operational_issue'].map(actionableCategory)).toEqual(['pain', 'pain'])
    expect(['desired_outcome', 'praise', 'purchase_trigger'].map(actionableCategory)).toEqual(['desired_outcome', 'desired_outcome', 'desired_outcome'])
    expect(actionableCategory('objection')).toBe('objection')
    expect(actionableCategory('emotion')).toBe('emotion')
    expect(actionableCategory('feature_request')).toBe('desired_outcome')
    expect(actionableCategory('other')).toBe('other')
    expect(actionableCategory('unknown_signal')).toBe('other')
    expect(actionableCategories(['purchase_trigger', 'objection'])).toEqual(['desired_outcome'])
    expect(actionableCategories(['pain', 'emotion'])).toEqual(['pain'])
    expect(actionableCategories(['other'])).toEqual(['other'])
  })

  it('projects only the dominant engine signal when deterministic clause siblings exist', () => {
    const signals = [
      { id: 'deterministic', interpretedBy: 'deterministic' as const },
      { id: 'engine', interpretedBy: 'analysis_engine' as const },
    ]
    expect(dominantCoverageSignals(signals)).toEqual([signals[1]])
    expect(dominantCoverageSignals(signals.slice(0, 1))).toEqual([signals[0]])
    expect(dominantCoverageSignals(signals, true)).toEqual([signals[1]])
    expect(dominantCoverageSignals([
      signals[1], { id: 'engine-sibling', interpretedBy: 'analysis_engine' as const },
    ], true)).toHaveLength(2)
  })
})

const enabledEnvironment = {
  GARAXE_LLM_ENRICHMENT_ENABLED: 'true',
  OPENCODE_GO_API_KEY: 'test-only-opencode-key',
  OPENCODE_GO_DEFAULT_MODEL: 'test-model',
  GARAXE_LLM_REQUEST_CAPACITY: '4',
  GARAXE_LLM_REQUESTS_PER_SECOND: '4',
  GARAXE_LLM_TOKEN_CAPACITY: '4000',
  GARAXE_LLM_TOKENS_PER_SECOND: '4000',
  GARAXE_LLM_GLOBAL_CONCURRENCY: '1',
  GARAXE_LLM_PROVIDER_CONCURRENCY: '1',
  GARAXE_LLM_ORGANIZATION_CONCURRENCY: '1',
  GARAXE_LLM_MAX_OUTPUT_TOKENS: '1200',
  GARAXE_LLM_DEADLINE_MS: '30000',
} as NodeJS.ProcessEnv

function demoInputFromComments(comments: string[]) {
  const rawCsv = rowsToCsv([['review_id', 'source', 'review_text'], ...comments.map((comment, index) => [`demo-${index + 1}`, 'Demo fixture', comment])])
  return { fileName: 'demo-feedback.csv', rawCsv, mapping: detectMapping(parseCsv(rawCsv).headers) }
}

function demoInputRange(start: number, count: number) {
  const rawCsv = rowsToCsv([['review_id', 'source', 'review_text', 'review_date'], ...Array.from({ length: count }, (_, index) => [
    `demo-${start + index}`, start === 1 ? 'Initial source' : 'Follow-up source',
    `Customer feedback ${start + index} describes a distinct realistic experience with enough detail for analysis.`,
    start === 1 ? '2026-01-10' : '2026-02-10',
  ])])
  return { fileName: `demo-${start}-${count}.csv`, rawCsv, mapping: detectMapping(parseCsv(rawCsv).headers) }
}

const comments = Array.from({ length: 10 }, (_, index) => `Customer feedback ${index + 1} explains that progress updates make the next step easier to trust.`)
const demoInput = demoInputFromComments(comments)

beforeAll(() => { process.env.GARAXE_DB_DIR = 'memory://' })
beforeEach(resetDatabaseForTests, 30_000)
afterAll(() => { delete process.env.GARAXE_DB_DIR })

describe('ephemeral same-engine demo sessions', () => {
  it('keeps fully categorized feedback usable when only recurrence grouping falls back', () => {
    const session = {
      status: 'completed',
      qualityReport: { clusterInterpretation: {
        state: 'partial_fallback', engineVersion: 'llm-interpreted-theme-engine-v1',
        jobs: { fallback: 1, failed: 0 }, emergingSignals: { total: 10, interpreted: 10, coverage: 1 },
      } },
    }
    expect(demoRunUsesOpenCode(session)).toBe(true)
    expect(demoRunUsesOpenCode({ ...session, qualityReport: { clusterInterpretation: {
      ...session.qualityReport.clusterInterpretation, emergingSignals: { coverage: .9 },
    } } })).toBe(false)
    expect(demoRunUsesOpenCode({ ...session, qualityReport: { clusterInterpretation: {
      ...session.qualityReport.clusterInterpretation, emergingSignals: undefined,
    } } })).toBe(false)
    expect(demoRunUsesOpenCode({ ...session, qualityReport: { clusterInterpretation: {
      ...session.qualityReport.clusterInterpretation, emergingSignals: { total: 10, interpreted: 9, coverage: 1 },
    } } })).toBe(false)
  })

  it('withholds discarded and unresolved split clusters from public demo output', () => {
    const theme = (publicationAction: 'publish' | 'discard', groupingAction: 'keep' | 'split') => ({
      validation: { status: 'validated', interpretationCandidate: { publicationAction, groupingAction } },
    })
    expect(isPublishableDemoTheme(theme('publish', 'keep'))).toBe(true)
    expect(isPublishableDemoTheme(theme('discard', 'keep'))).toBe(false)
    expect(isPublishableDemoTheme(theme('publish', 'split'))).toBe(false)
    expect(isPublishableDemoTheme({ validation: { status: 'insufficient_evidence', interpretationCandidate: { publicationAction: 'publish', groupingAction: 'keep' } } })).toBe(false)
    expect(isPublishableDemoTheme({ validation: {} })).toBe(false)
  })

  it('refuses to create a demo run unless the OpenCode interpretation contract is configured', async () => {
    await expect(createDemoAnalysisSession(await getDatabase(), demoInput, {}, new Date('2026-08-10T10:00:00Z')))
      .rejects.toMatchObject({ code: 'DEMO_ANALYSIS_UNAVAILABLE', status: 503 } satisfies Partial<DemoAnalysisError>)
  })

  it('creates one isolated tenant, one bounded run, and submitted input for exactly 24 hours', async () => {
    const database = await getDatabase()
    const createdAt = new Date('2026-08-10T10:00:00Z')
    const session = await createDemoAnalysisSession(database, demoInput, enabledEnvironment, createdAt)
    const stored = await database.query<{ tokenHash: string; expiresAt: string }>(
      'SELECT token_hash AS "tokenHash", expires_at AS "expiresAt" FROM demo_analysis_sessions',
    )
    const counts = await database.query<{ organizations: number; projects: number; reviews: number; runs: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM organizations) AS organizations,
        (SELECT COUNT(*)::int FROM projects) AS projects,
        (SELECT COUNT(*)::int FROM reviews) AS reviews,
        (SELECT COUNT(*)::int FROM analysis_runs) AS runs`,
    )

    expect(counts.rows[0]).toEqual({ organizations: 1, projects: 1, reviews: 10, runs: 1 })
    expect(new Date(session.expiresAt).getTime() - createdAt.getTime()).toBe(DEMO_RETENTION_MS)
    expect(stored.rows[0]?.tokenHash).not.toBe(session.token)
    expect(new Date(stored.rows[0]?.expiresAt || '').toISOString()).toBe(session.expiresAt)
    expect(await getDemoAnalysisSession(database, session.token, createdAt)).toMatchObject({
      projectId: session.projectId,
      analysisRunId: session.analysisRunId,
      status: 'queued',
    })
  })

  it('stores CSV date-only values at UTC midnight like authenticated imports', async () => {
    const database = await getDatabase()
    const rawCsv = rowsToCsv([['review_id', 'source', 'rating', 'rating_scale', 'review_text', 'review_date'], ...Array.from({ length: 6 }, (_, index) => [
      `dated-${index}`, 'Demo fixture', '2', '5', `A realistic dated comment ${index} with enough detail for analysis.`, '2026-01-10',
    ])])
    await createDemoAnalysisSession(database, { fileName: 'dated.csv', rawCsv, mapping: detectMapping(parseCsv(rawCsv).headers) }, enabledEnvironment, new Date('2026-08-10T10:00:00Z'))
    const stored = await database.query<{ sourceCreatedAt: string | Date; ratingScale: number | null }>('SELECT source_created_at AS "sourceCreatedAt", rating_scale AS "ratingScale" FROM reviews ORDER BY id LIMIT 1')
    expect(new Date(stored.rows[0]?.sourceCreatedAt || '').toISOString()).toBe('2026-01-10T00:00:00.000Z')
    expect(stored.rows[0]?.ratingScale).toBe(5)
  })

  it('accepts one CSV up to the full remaining Demo allowance', async () => {
    const database = await getDatabase()
    const session = await createDemoAnalysisSession(
      database,
      { ...demoInputRange(1, 50), clientKey: 'single-file-client' },
      enabledEnvironment,
      new Date('2026-08-13T08:00:00Z'),
    )
    const stored = await database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reviews WHERE project_id = $1',
      [session.projectId],
    )
    expect(stored.rows[0]?.count).toBe(50)
    await expect(getDemoAnalysisSession(database, session.token, new Date('2026-08-13T08:00:00Z')))
      .resolves.toMatchObject({ quota: { remaining: 0, resetAt: '2026-08-13T16:00:00.000Z' } })
  })

  it('imports only the first 50 eligible unique rows from a larger Demo CSV and reports the remainder', async () => {
    const database = await getDatabase()
    const session = await createDemoAnalysisSession(
      database,
      { ...demoInputRange(1, 100), clientKey: 'large-file-client' },
      enabledEnvironment,
      new Date('2026-08-13T08:00:00Z'),
    )
    const stored = await database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reviews WHERE project_id = $1',
      [session.projectId],
    )
    expect(stored.rows[0]?.count).toBe(50)
    expect(session).toMatchObject({ addedRecords: 50, notImportedRecords: 50 })
  })

  it('starts an eight-hour cooldown when the 50th unique Demo comment is accepted', async () => {
    const database = await getDatabase()
    const startedAt = new Date('2026-08-13T08:00:00Z')
    const clientKey = 'cooldown-client'
    const first = await createDemoAnalysisSession(database, { ...demoInputRange(1, 10), clientKey }, enabledEnvironment, startedAt)
    await database.query(`UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1`, [first.analysisRunId])

    await expect(appendDemoAnalysisSessionCsv(database, first.token, demoInputRange(11, 41), enabledEnvironment, new Date('2026-08-13T08:30:00Z')))
      .resolves.toMatchObject({ addedRecords: 40, notImportedRecords: 1, quota: { remaining: 0 } })
    await expect(database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM reviews WHERE project_id = $1', [first.projectId]))
      .resolves.toMatchObject({ rows: [{ count: 50 }] })
    const appended = await getDemoAnalysisSession(database, first.token, new Date('2026-08-13T08:30:00Z'))
    await database.query(`UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1`, [appended!.analysisRunId])

    const retry = await appendDemoAnalysisSessionCsv(database, first.token, demoInputRange(11, 40), enabledEnvironment, new Date('2026-08-13T09:05:00Z'))
    expect(retry).toMatchObject({
      projectId: first.projectId,
      analysisRunId: appended!.analysisRunId,
      addedRecords: 0,
      quota: { remaining: 0, resetAt: '2026-08-13T16:30:00.000Z' },
    })
    await expect(appendDemoAnalysisSessionCsv(database, first.token, demoInputRange(51, 1), enabledEnvironment, new Date('2026-08-13T16:29:59.999Z')))
      .rejects.toMatchObject({ code: 'DEMO_CAPACITY_EXCEEDED', status: 429 } satisfies Partial<DemoAnalysisError>)
    await expect(createDemoAnalysisSession(database, { ...demoInputRange(51, 10), clientKey }, enabledEnvironment, new Date('2026-08-13T16:29:59.999Z')))
      .rejects.toMatchObject({ code: 'DEMO_CAPACITY_EXCEEDED', status: 429 } satisfies Partial<DemoAnalysisError>)
    await expect(appendDemoAnalysisSessionCsv(database, first.token, demoInputRange(11, 40), enabledEnvironment, new Date('2026-08-13T16:30:00Z')))
      .resolves.toMatchObject({ addedRecords: 0, quota: { remaining: 0, resetAt: null, freshDemoAvailable: true } })
    await expect(appendDemoAnalysisSessionCsv(database, first.token, demoInputRange(51, 1), enabledEnvironment, new Date('2026-08-13T16:30:00Z')))
      .rejects.toMatchObject({ code: 'DEMO_SESSION_EXHAUSTED', status: 409 } satisfies Partial<DemoAnalysisError>)
    const fresh = await createDemoAnalysisSession(database, { ...demoInputRange(51, 10), clientKey }, enabledEnvironment, new Date('2026-08-13T16:30:00Z'))
    expect(fresh.projectId).not.toBe(first.projectId)
    const counts = await database.query<{ oldReviews: number; newReviews: number; projects: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM reviews WHERE project_id = $1) AS "oldReviews",
        (SELECT COUNT(*)::int FROM reviews WHERE project_id = $2) AS "newReviews",
        (SELECT COUNT(*)::int FROM projects) AS projects`, [first.projectId, fresh.projectId],
    )
    expect(counts.rows[0]).toEqual({ oldReviews: 50, newReviews: 10, projects: 2 })
    expect(await getDemoAnalysisSession(database, first.token, new Date('2026-08-13T16:30:00Z'))).toMatchObject({ analysisRunId: appended!.analysisRunId })
  })

  it('enforces per-client start and active-run limits before creating more demo tenants', async () => {
    const database = await getDatabase()
    const environment = {
      ...enabledEnvironment,
      GARAXE_DEMO_CLIENT_STARTS_PER_HOUR: '2',
      GARAXE_DEMO_GLOBAL_ACTIVE_RUNS: '10',
      GARAXE_DEMO_CLIENT_ACTIVE_RUNS: '1',
    }
    const first = await createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-a' }, environment)
    await expect(createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-a' }, environment))
      .rejects.toMatchObject({ code: 'DEMO_CONCURRENCY_LIMITED', status: 429 } satisfies Partial<DemoAnalysisError>)
    await database.query(`UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1`, [first.analysisRunId])
    await createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-a' }, environment)
    await expect(createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-a' }, environment))
      .rejects.toMatchObject({ code: 'DEMO_RATE_LIMITED', status: 429 } satisfies Partial<DemoAnalysisError>)
  })

  it('caps active public demo work globally while allowing another client after capacity is released', async () => {
    const database = await getDatabase()
    const environment = {
      ...enabledEnvironment,
      GARAXE_DEMO_CLIENT_STARTS_PER_HOUR: '10',
      GARAXE_DEMO_GLOBAL_ACTIVE_RUNS: '2',
      GARAXE_DEMO_CLIENT_ACTIVE_RUNS: '1',
    }
    const first = await createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-a' }, environment)
    await createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-b' }, environment)
    await expect(createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-c' }, environment))
      .rejects.toMatchObject({ code: 'DEMO_CONCURRENCY_LIMITED', status: 429 } satisfies Partial<DemoAnalysisError>)
    await database.query(`UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1`, [first.analysisRunId])
    await expect(createDemoAnalysisSession(database, { ...demoInput, clientKey: 'client-c' }, environment)).resolves.toMatchObject({ projectId: expect.any(String) })
  })

  it('retains distinct submitted records with identical text for recurrence analysis', async () => {
    const repeated = Array.from({ length: 10 }, (_, index) => index < 2
      ? 'The export froze at 90%, so I could not deliver the report on time.'
      : `Customer feedback ${index + 1} contains a distinct supported product claim for analysis.`)
    const session = await createDemoAnalysisSession(await getDatabase(), demoInputFromComments(repeated), enabledEnvironment)
    const reviews = await (await getDatabase()).query<{ count: number; uniqueTexts: number }>(
      `SELECT COUNT(*)::int AS count, COUNT(DISTINCT body_original)::int AS "uniqueTexts" FROM reviews WHERE project_id = $1`, [session.projectId],
    )
    expect(reviews.rows[0]).toEqual({ count: 10, uniqueTexts: 9 })
  })

  it('keeps coherent individual claims visible as low-confidence emerging signals', async () => {
    const database = await getDatabase()
    const session = await createDemoAnalysisSession(database, demoInput, enabledEnvironment)
    const review = await database.query<{ id: string; body: string }>('SELECT id, body_original AS body FROM reviews ORDER BY imported_at, id LIMIT 1')
    const source = review.rows[0]!
    const quote = 'progress updates make the next step easier to trust'
    const quoteStart = source.body.indexOf(quote)
    await database.query(
      `INSERT INTO analysis_run_reviews (analysis_run_id, review_id, inclusion_status, normalized_text, preprocessing_version)
       VALUES ($1,$2,'included',$3,'test')`,
      [session.analysisRunId, source.id, source.body],
    )
    await database.query(
      `INSERT INTO review_signals
        (id, analysis_run_id, review_id, signal_type, label, normalized_aspect, sentiment, confidence, quote_text, quote_start, quote_end, attributes, extractor_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      ['emerging-signal', session.analysisRunId, source.id, 'desired_outcome', 'Clear progress updates', 'progress updates', 'positive', .71, quote, quoteStart, quoteStart + quote.length, JSON.stringify({
        clusterStatus: 'unclustered', emergingInterpretation: { label: 'Predictable next-step updates', signalTypes: ['desired_outcome'], evidence: { reviewId: source.id, quoteText: quote } },
      }), 'test'],
    )

    expect((await getAnalysisCoverage(database, session.analysisRunId))[0]).toMatchObject({
      disposition: 'emerging',
      reason: 'This comment has its own topic; more feedback may confirm recurrence.',
      signals: [{ label: 'Predictable next-step updates', signalType: 'desired_outcome', category: 'desired_outcome', confidence: .71, quote, interpretedBy: 'analysis_engine' }],
    })
  })

  it('keeps a canonical one-comment bucket emerging while retaining its stable bucket id', async () => {
    const database = await getDatabase()
    const session = await createDemoAnalysisSession(database, demoInput, enabledEnvironment)
    const review = await database.query<{ id: string; body: string }>('SELECT id, body_original AS body FROM reviews ORDER BY imported_at, id LIMIT 1')
    const source = review.rows[0]!
    const quote = 'progress updates make the next step easier to trust'
    const quoteStart = source.body.indexOf(quote)
    await database.query(
      `INSERT INTO analysis_run_reviews (analysis_run_id, review_id, inclusion_status, normalized_text, preprocessing_version)
       VALUES ($1,$2,'included',$3,'test')`, [session.analysisRunId, source.id, source.body],
    )
    await database.query(
      `INSERT INTO review_signals
        (id, analysis_run_id, review_id, signal_type, label, normalized_aspect, sentiment, confidence,
         quote_text, quote_start, quote_end, attributes, extractor_version)
       VALUES ('singleton-signal',$1,$2,'desired_outcome','Predictable updates','progress updates','positive',.49,$3,$4,$5,$6,'test')`,
      [session.analysisRunId, source.id, quote, quoteStart, quoteStart + quote.length, JSON.stringify({ emergingInterpretation: {
        label: 'Predictable updates', aspect: 'progress updates', topic: 'progress updates', primaryCategory: 'desired_outcome',
        signalTypes: ['desired_outcome'], confidence: .49,
        evidence: { reviewId: source.id, quoteText: quote, quoteStart, quoteEnd: quoteStart + quote.length },
      } })],
    )
    await database.query(
      `INSERT INTO themes
        (id, analysis_run_id, name, description, theme_type, sentiment, confidence, rank, metrics, validation, engine_version)
       VALUES ('singleton-theme',$1,'Predictable updates','One resolved comment.','desired_outcome','mixed','Emerging',1,
        '{"independentReviewCount":1}',
        '{"status":"validated","projection":"category_first","category":"desired_outcome","interpretationCandidate":{"publicationAction":"publish","groupingAction":"keep"}}',
        'llm-interpreted-theme-engine-v1')`, [session.analysisRunId],
    )
    await database.query(
      `INSERT INTO theme_evidence (theme_id, signal_id, review_id, evidence_strength, is_representative)
       VALUES ('singleton-theme','singleton-signal',$1,.49,true)`, [source.id],
    )

    expect((await getAnalysisCoverage(database, session.analysisRunId))[0]).toMatchObject({
      disposition: 'emerging', themeIds: ['singleton-theme'],
      signals: [{ category: 'desired_outcome', label: 'Predictable updates' }],
    })
  })

  it('keeps one dominant signal by default and exposes every aspect only behind the runtime flag', async () => {
    const database = await getDatabase()
    const session = await createDemoAnalysisSession(database, demoInput, enabledEnvironment)
    const review = await database.query<{ id: string; body: string }>('SELECT id, body_original AS body FROM reviews ORDER BY imported_at, id LIMIT 1')
    const source = review.rows[0]!
    await database.query(
      `INSERT INTO analysis_run_reviews (analysis_run_id, review_id, inclusion_status, normalized_text, preprocessing_version)
       VALUES ($1,$2,'included',$3,'test')`,
      [session.analysisRunId, source.id, source.body],
    )
    for (const [id, clusterStatus, signalType, label, confidence] of [
      ['clustered-signal', 'clustered', 'desired_outcome', 'Progress updates', .82],
      ['unclustered-signal', 'unclustered', 'pain', 'Missing progress', .71],
    ] as const) {
      const quote = 'progress updates'
      const quoteStart = source.body.indexOf(quote)
      await database.query(
        `INSERT INTO review_signals
          (id, analysis_run_id, review_id, signal_type, label, normalized_aspect, sentiment, confidence, quote_text, quote_start, quote_end, attributes, extractor_version)
         VALUES ($1,$2,$3,$4,$5,$5,'positive',$6,$7,$8,$9,$10,'test')`,
        [id, session.analysisRunId, source.id, signalType, label, confidence, quote, quoteStart, quoteStart + quote.length, JSON.stringify({ clusterStatus })],
      )
    }

    expect((await loadEmergingSignalWork(database, session.analysisRunId)).themes.map((item) => item.themeId)).toEqual([
      'clustered-signal',
    ])
    const aspectWork = await loadEmergingSignalWork(database, session.analysisRunId, null, {
      VOICE_LAB_ASPECT_SEMANTICS_ENABLED: 'true',
    })
    expect(aspectWork.themes.map((item) => item.themeId)).toEqual(['clustered-signal'])
    expect(aspectWork.themes[0]?.occurrences?.map((item) => item.signalId)).toEqual([
      'clustered-signal', 'unclustered-signal',
    ])
  })

  it('deletes source data and derived run artifacts after the fixed expiry', async () => {
    const database = await getDatabase()
    const createdAt = new Date('2026-08-10T10:00:00Z')
    const session = await createDemoAnalysisSession(database, demoInput, enabledEnvironment, createdAt)

    expect(await cleanupExpiredDemoAnalysisSessions(database, new Date(createdAt.getTime() + DEMO_RETENTION_MS - 1))).toBe(0)
    expect(await cleanupExpiredDemoAnalysisSessions(database, new Date(createdAt.getTime() + DEMO_RETENTION_MS))).toBe(1)
    expect(await getDemoAnalysisSession(database, session.token, new Date(createdAt.getTime() + DEMO_RETENTION_MS))).toBeNull()
    const counts = await database.query<{ organizations: number; projects: number; sessions: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM organizations) AS organizations,
        (SELECT COUNT(*)::int FROM projects) AS projects,
        (SELECT COUNT(*)::int FROM demo_analysis_sessions) AS sessions`,
    )
    expect(counts.rows[0]).toEqual({ organizations: 0, projects: 0, sessions: 0 })
  })

  it('enforces demo byte and per-review limits before creating any tenant data', async () => {
    const database = await getDatabase()
    await expect(createDemoAnalysisSession(database, { rawCsv: 'too short' }, enabledEnvironment)).rejects.toMatchObject({ code: 'DEMO_INPUT_INVALID', status: 400 })
    await expect(createDemoAnalysisSession(database, demoInputFromComments(Array.from({ length: 6 }, () => 'x'.repeat(3000))), enabledEnvironment)).rejects.toMatchObject({ code: 'DEMO_INPUT_TOO_LARGE', status: 413 })
    const counts = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM demo_analysis_sessions')
    expect(counts.rows[0]?.count).toBe(0)
  })
})
