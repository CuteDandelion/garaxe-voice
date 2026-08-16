// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { demoClientKey, handleRequest } from './app'
import { getDatabase, getDemoDatabase, resetDatabaseForTests } from './db'
import { createIdentity, createSession } from './auth'
import { encryptSecret } from './googleOAuth'
import { saveGoogleConnection } from './googleConnections'
import {
  CLUSTER_INTERPRETATION_JOB_KIND,
  CLUSTER_INTERPRETATION_SCHEMA_VERSION,
  LLM_INTERPRETED_ENGINE_VERSION,
  createClusterInterpretationWorker,
  settleClusterInterpretationRuns,
} from './clusterInterpretation'
import { detectMapping, parseCsv, rowsToCsv, sampleCsv } from '../src/lib/csv'
import { cleanupExpiredDemoAnalysisSessions, DEMO_RETENTION_MS, getDemoAnalysisSession } from './demoAnalysis'
import { SIGNAL_TAXONOMY_VERSION } from './canonicalOutcome'

let server: Server
let baseUrl = ''
let authToken = ''

function demoCsvPayload(comments: string[]) {
  const rawCsv = rowsToCsv([['review_id', 'source', 'review_text'], ...comments.map((comment, index) => [`demo-${index + 1}`, 'Demo fixture', comment])])
  return { fileName: 'demo.csv', rawCsv, mapping: detectMapping(parseCsv(rawCsv).headers) }
}

function apiFetch(input: string, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: { ...init.headers, ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
  })
}

beforeAll(async () => {
  server = createServer((request, response) => void handleRequest(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start.')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  process.env.GARAXE_ADMIN_BOOTSTRAP_ENABLED = 'true'
  await resetDatabaseForTests()
  authToken = ''
  const response = await apiFetch(`${baseUrl}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', displayName: 'Test Owner', organizationName: 'Test Organization' }),
  })
  authToken = (await response.json()).data.token
})

afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))

async function post(path: string, payload: unknown) {
  return apiFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('public waitlist API', () => {
  it('stores one normalized consented signup and answers duplicates identically without a public read route', async () => {
    const ownerToken = authToken
    authToken = ''
    const payload = { name: '  Researcher Name  ', email: '  Researcher@Example.COM ', consentVersion: 'voice-lab-waitlist-v1' }
    const first = await post('/api/waitlist', payload)
    const duplicate = await post('/api/waitlist', payload)

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ data: { status: 'recorded' } })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ data: { status: 'recorded' } })
    const database = await getDatabase()
    const stored = await database.query<{ name: string; email: string; consentVersion: string; createdAt: string }>(
      `SELECT name, email_normalized AS email, consent_version AS "consentVersion", created_at AS "createdAt" FROM waitlist_signups`,
    )
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0]).toMatchObject({ name: 'Researcher Name', email: 'researcher@example.com', consentVersion: 'voice-lab-waitlist-v1' })
    expect(Number.isNaN(Date.parse(stored.rows[0].createdAt))).toBe(false)

    const list = await apiFetch(`${baseUrl}/api/waitlist`)
    expect(list.status).toBe(401)
    authToken = ownerToken
    const authenticatedList = await apiFetch(`${baseUrl}/api/waitlist`)
    expect(authenticatedList.status).toBe(404)
  })

  it('rejects invalid or unconsented submissions without storing them', async () => {
    authToken = ''
    for (const payload of [
      { name: '', email: 'person@example.com', consentVersion: 'voice-lab-waitlist-v1' },
      { name: 'Person', email: 'not-an-email', consentVersion: 'voice-lab-waitlist-v1' },
      { name: 'Person', email: 'person@example.com', consentVersion: '' },
    ]) {
      const response = await post('/api/waitlist', payload)
      expect(response.status).toBe(400)
    }
    const database = await getDatabase()
    const stored = await database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM waitlist_signups')
    expect(stored.rows[0]?.count).toBe('0')
  })
})

async function importCsv(projectId: string, rawCsv: string) {
  const parsedInput = parseCsv(rawCsv)
  const headers = [...parsedInput.headers]
  const addsSource = !headers.includes('source')
  const addsRatingScale = headers.includes('rating') && !headers.includes('rating_scale')
  if (addsSource) headers.splice(1, 0, 'source')
  if (addsRatingScale) headers.splice(headers.indexOf('rating') + 1, 0, 'rating_scale')
  const rawFixtureCsv = rowsToCsv([
    headers,
    ...parsedInput.rows.map((row) => headers.map((header) => addsSource && header === 'source' ? 'google_business' : addsRatingScale && header === 'rating_scale' ? '5' : row[header] || '')),
  ])
  const parsed = parseCsv(rawFixtureCsv)
  const mapping = detectMapping(parsed.headers)
  for (const header of parsed.headers) if (mapping[header] === 'unmapped') mapping[header] = 'excluded'
  const created = await post('/api/imports', {
    projectId,
    fileName: 'inventory.csv',
    rawCsv: rawFixtureCsv,
    mapping,
  }).then((response) => response.json())
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await apiFetch(`${baseUrl}/api/imports/${created.data.id}`).then((response) => response.json())
    if (job.data.status === 'completed') return created.data.id as string
    if (job.data.status === 'failed') throw new Error(String(job.data.errorMessage))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Import did not complete.')
}

async function waitForAnalysis(runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await apiFetch(`${baseUrl}/api/analysis-runs/${runId}`)
    const payload = await response.json()
    if (payload.data.status === 'completed') return payload.data
    if (payload.data.status === 'failed') throw new Error(String(payload.data.errorMessage))
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Analysis did not complete.')
}

async function createCurationFixture(name: string) {
  const project = await post('/api/projects', { name, primaryDecision: 'research' }).then((response) => response.json())
  await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
${name}-1,google_business,Berlin,5,"The staff were friendly and welcoming",2026-01-10,en
${name}-2,google_business,Hamburg,5,"The staff were kind and helpful",2026-02-10,en
${name}-3,google_business,Berlin,2,"Support was too slow and frustrating",2026-03-10,en
${name}-4,google_business,Hamburg,2,"The setup was too complicated",2026-04-10,en`)
  const created = await post('/api/analysis-runs', {
    projectId: project.data.id,
    configuration: { objective: 'full_voice_map', writtenOnly: true, minTextLength: 3 },
  }).then((response) => response.json())
  await waitForAnalysis(created.data.id)
  const voiceMap = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/voice-map`).then((response) => response.json())
  return { projectId: project.data.id as string, runId: created.data.id as string, voiceMap: voiceMap.data }
}

async function createCuration(runId: string) {
  const response = await post(`/api/analysis-runs/${runId}/curation-sessions`, {})
  const payload = await response.json()
  return { response, session: payload.data.session }
}

async function curate(sessionId: string, actionType: string, payload: Record<string, unknown> = {}) {
  const response = await post(`/api/curation-sessions/${sessionId}/actions`, { actionType, payload })
  return { response, payload: await response.json() }
}

describe('persistent project and import API', () => {
  it('accepts only original UTF-8 CSV artifacts at the authenticated import boundary', async () => {
    const project = await post('/api/projects', { name: 'CSV boundary', primaryDecision: 'research' }).then((response) => response.json())
    const rawCsv = 'review_id,source,review_text\nr1,test,A complete valid comment for import.'
    const response = await post('/api/imports', {
      projectId: project.data.id,
      fileName: 'feedback.json',
      rawCsv,
      mapping: detectMapping(parseCsv(rawCsv).headers),
      originalSource: { encoding: 'utf8', content: rawCsv, mediaType: 'application/json' },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'IMPORT_CONTENT_INVALID' } })
    const jobs = await (await getDatabase()).query<{ count: number }>('SELECT COUNT(*)::int AS count FROM import_jobs WHERE project_id = $1', [project.data.id])
    expect(jobs.rows[0]?.count).toBe(0)
  })

  it('uses forwarded client identity only when the reverse proxy is explicitly trusted', () => {
    const request = {
      headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Parameters<typeof demoClientKey>[0]
    expect(demoClientKey(request, {})).toBe(demoClientKey({ ...request, headers: {} }, {}))
    expect(demoClientKey(request, { GARAXE_TRUST_PROXY: 'true' })).not.toBe(demoClientKey(request, {}))
  })

  it('runs the isolated public demo through the OpenCode interpretation engine and downloads a no-store PDF', async () => {
    const requestSizes: number[] = []
    let pairAdjudicationRequests = 0
    let failedBatchKey: string | null = null
    let failedBatchAttempts = 0
    const provider = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: Array<{ role: string; content: string }> }
      const system = payload.messages.find((message) => message.role === 'system')?.content || ''
      const work = JSON.parse(payload.messages.find((message) => message.role === 'user')?.content || '{}') as {
        themes?: Array<{ themeId: string; currentLabel: string; currentType: string; needsAdjudication?: boolean; evidence: Array<{ reviewId: string; quoteText: string }> }>
        pairs?: Array<{ pairId: string; left: { topic: string; quoteText: string }; right: { topic: string; quoteText: string } }>
      }
      if (system.includes('explicitly ambiguous customer-feedback pairs')) {
        pairAdjudicationRequests += 1
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ decisions: (work.pairs || []).map((pair) => ({
            pairId: pair.pairId, sameTopic: pair.left.topic === pair.right.topic
              && !(pair.left.quoteText.includes('compile progress') || pair.right.quoteText.includes('compile progress')),
          })) }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }))
        return
      }
      const batch = work.themes || []
      requestSizes.push(batch.length)
      const batchKey = batch.map((theme) => theme.themeId).join(',')
      if (system.includes('single-comment emerging') && batch.length === 5 && (failedBatchKey === null || failedBatchKey === batchKey) && failedBatchAttempts < 2) {
        failedBatchKey = batchKey
        failedBatchAttempts += 1
        response.statusCode = 503
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: { message: 'temporary test outage' } }))
        return
      }
      const interpretations = system.includes('semantic scout') ? [] : (work.themes || []).map((theme) => ({
        themeId: theme.themeId,
        label: `${system.includes('single-comment emerging') ? 'Engine emerging' : 'Engine cluster'} ${theme.currentLabel}`.trim().split(/\s+/).slice(0, 6).join(' '),
        aspect: theme.evidence.some((item) => item.quoteText.includes('dismissed error')) ? 'error recovery'
          : theme.evidence.some((item) => item.quoteText.includes('compile progress') || item.quoteText.includes('conversation mode')) ? 'application mode'
            : 'progress updates',
        evaluation: theme.currentType === 'praise' ? 'praise' : 'pain',
        signalTypes: [system.includes('single-comment emerging') ? 'objection' : theme.currentType === 'praise' ? 'desired_outcome' : 'pain'],
        sentiment: theme.currentType === 'praise' ? 'positive' : system.includes('single-comment emerging') ? 'neutral' : 'negative',
        rootCause: null,
        consequence: null,
        evidence: theme.evidence.map((item) => ({ reviewId: item.reviewId, quoteText: item.quoteText })),
        rootCauseEvidence: null,
        consequenceEvidence: null,
        confidence: .9,
        publicationAction: 'publish',
        publicationReason: null,
        groupingAction: 'keep',
        groupingReason: null,
      }))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ schemaVersion: CLUSTER_INTERPRETATION_SCHEMA_VERSION, interpretations }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }))
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    const providerAddress = provider.address()
    if (!providerAddress || typeof providerAddress === 'string') throw new Error('Provider fixture did not start.')
    Object.assign(process.env, {
      GARAXE_LLM_ENRICHMENT_ENABLED: 'true', OPENCODE_GO_API_KEY: 'test-only-opencode-key', OPENCODE_GO_DEFAULT_MODEL: 'test-model',
      OPENCODE_GO_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
      GARAXE_LLM_REQUEST_CAPACITY: '20', GARAXE_LLM_REQUESTS_PER_SECOND: '100', GARAXE_LLM_TOKEN_CAPACITY: '20000', GARAXE_LLM_TOKENS_PER_SECOND: '20000',
      GARAXE_LLM_GLOBAL_CONCURRENCY: '1', GARAXE_LLM_PROVIDER_CONCURRENCY: '1', GARAXE_LLM_ORGANIZATION_CONCURRENCY: '1',
      GARAXE_LLM_MAX_OUTPUT_TOKENS: '1200', GARAXE_LLM_DEADLINE_MS: '30000',
    })
    const authenticatedDatabase = await getDatabase()
    const database = await getDemoDatabase()
    const before = await authenticatedDatabase.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM reports')
    try {
      authToken = ''
      const createdResponse = await fetch(`${baseUrl}/api/demo/analysis-runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(demoCsvPayload([
          'Compile progress appears separately from logs.',
          'Conversation mode selection appears per chat.',
          ...Array.from({ length: 7 }, (_, index) => `Customer ${index + 1} loved the clear progress update because it made the next step easy to trust.`),
          'I hate that a dismissed error notification disappears before I can understand how to recover from the failure.',
        ])),
      })
      const created = await createdResponse.json()
      expect(createdResponse.status).toBe(202)
      expect(created.data).toMatchObject({ status: 'queued', retentionHours: 24 })
      expect(JSON.stringify(created)).not.toContain(process.env.OPENCODE_GO_API_KEY)

      const worker = await createClusterInterpretationWorker(database)
      expect(worker).not.toBeNull()
      let completed: Record<string, any> | null = null
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (worker) await worker.runOnce()
        await settleClusterInterpretationRuns(database)
        const response = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}`)
        const payload = await response.json()
        if (payload.data.status === 'completed') { completed = payload.data; break }
        if (payload.data.status === 'failed') {
          const failed = await database.query('SELECT stage, quality_report, error_message FROM analysis_runs ORDER BY created_at DESC LIMIT 1')
          throw new Error(`${payload.data.message}: ${JSON.stringify(failed.rows[0])}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const diagnostic = await database.query('SELECT status, stage, quality_report, error_message FROM analysis_runs ORDER BY created_at DESC LIMIT 1')
      expect(completed, JSON.stringify(diagnostic.rows[0])).toMatchObject({ status: 'completed', engine: LLM_INTERPRETED_ENGINE_VERSION, demo: true })
      expect(completed?.themes.length).toBeGreaterThan(0)
      const phases = await database.query<{ signalJobs: number; groupJobs: number; pairJobs: number }>(
        `SELECT COUNT(*) FILTER (WHERE kind LIKE 'emerging_signal_interpretation:%')::int AS "signalJobs",
          COUNT(*) FILTER (WHERE kind LIKE 'cluster_interpretation:%')::int AS "groupJobs",
          COUNT(*) FILTER (WHERE kind LIKE 'candidate_pair_adjudication:%')::int AS "pairJobs"
         FROM llm_jobs WHERE analysis_run_id = (SELECT analysis_run_id FROM demo_analysis_sessions ORDER BY created_at DESC LIMIT 1)`,
      )
      expect(phases.rows[0]).toMatchObject({ signalJobs: expect.any(Number), groupJobs: expect.any(Number), pairJobs: expect.any(Number) })
      expect(phases.rows[0].signalJobs).toBeGreaterThan(0)
      expect(phases.rows[0].groupJobs).toBe(0)
      expect(phases.rows[0].pairJobs).toBeGreaterThan(0)
      expect(pairAdjudicationRequests).toBe(phases.rows[0].pairJobs)
      expect(failedBatchAttempts).toBe(2)
      expect(requestSizes.filter((size) => size === 5)).toHaveLength(3)
      expect(requestSizes).toEqual(expect.arrayContaining([2, 3]))
      const staleThemes = await database.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM themes
         WHERE analysis_run_id = (SELECT analysis_run_id FROM demo_analysis_sessions ORDER BY created_at DESC LIMIT 1)
           AND validation->>'projection' IS DISTINCT FROM 'category_first'`,
      )
      expect(staleThemes.rows[0].count).toBe(0)
      expect(completed?.coverage).toHaveLength(10)
      expect(completed?.coverage.every((item: { disposition?: string; reason?: string }) => item.disposition && item.reason)).toBe(true)
      const emerging = completed?.coverage.filter((item: { disposition: string }) => item.disposition === 'emerging') || []
      expect(emerging.length).toBeGreaterThan(0)
      expect(emerging.every((item: { signals: Array<{ label: string; quote: string; confidence: number; interpretedBy: string; signalTypes: string[]; categories: string[]; category: string }>; originalText: string }) => item.signals.length > 0 && item.signals.every((signal) => signal.label.startsWith('Engine emerging') && signal.interpretedBy === 'analysis_engine' && signal.confidence <= .49 && item.originalText.includes(signal.quote)
        && signal.signalTypes.includes('objection') && signal.categories.includes('objection') && signal.category === 'objection'))).toBe(true)
      expect(completed?.coverage.every((item: { disposition: string; originalText: string; signals: Array<{ label: string; quote: string; interpretedBy: string }> }) =>
        ['recurring', 'emerging'].includes(item.disposition)
        &&
        item.signals.length > 0 && item.signals.every((signal) => signal.label.startsWith('Engine emerging')
          && signal.interpretedBy === 'analysis_engine' && item.originalText.includes(signal.quote)))).toBe(true)
      expect(JSON.stringify(completed)).not.toContain('demo_upload')

      const overviewResponse = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/overview`)
      expect(overviewResponse.status).toBe(200)
      expect(await overviewResponse.json()).toMatchObject({ data: {
        status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null,
      } })

      const curationResponse = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`)
      const curation = await curationResponse.json()
      expect(curationResponse.status).toBe(200)
      expect(JSON.stringify(curation)).not.toContain('demo_upload')
      expect(emerging.every((item: { reviewId: string }) => curation.data.machineThemes.some((theme: { signalTypes: string[]; categories: string[]; evidence: Array<{ reviewId: string; originalText: string; quote: string }> }) =>
        theme.signalTypes.includes('objection') && theme.categories.includes('objection')
        && theme.evidence.some((evidence) => evidence.reviewId === item.reviewId && evidence.originalText.includes(evidence.quote))))).toBe(true)
      const curatedTheme = curation.data.effectiveThemes.find((theme: { status: string }) => theme.status !== 'not_reviewable')
      expect(curatedTheme).toBeTruthy()
      const editResponse = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionType: 'edit_theme', payload: { themeId: curatedTheme.id, name: 'Temporary customer progress', summary: 'A demo-only curated interpretation.' } }),
      })
      expect(editResponse.status).toBe(201)
      const edited = await editResponse.json()
      expect(edited.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === curatedTheme.id)).toMatchObject({
        name: 'Temporary customer progress', origin: 'user_curated',
      })
      const refreshed = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}`).then((response) => response.json())
      expect(refreshed.data.themes.find((theme: { id: string }) => theme.id === curatedTheme.id)).toMatchObject({ name: 'Temporary customer progress', evidence: expect.arrayContaining(completed?.themes[0].evidence) })
      const curatedThemeReviewCount = completed?.coverage.filter((item: { themeIds: string[] }) => item.themeIds.includes(curatedTheme.id)).length
      expect(refreshed.data.themes.find((theme: { id: string }) => theme.id === curatedTheme.id).evidence).toHaveLength(curatedThemeReviewCount)
      expect(JSON.stringify(refreshed)).not.toContain('authenticated analyst')
      for (let index = 1; index < 50; index += 1) {
        const action = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actionType: 'edit_theme', payload: { themeId: curatedTheme.id, name: `Temporary customer progress ${index}` } }),
        })
        expect(action.status).toBe(201)
      }
      const saturated = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionType: 'edit_theme', payload: { themeId: curatedTheme.id, name: 'One edit too many' } }),
      })
      expect(saturated.status).toBe(429)

      const response = await fetch(`${baseUrl}${completed?.pdfUrl}`)
      const pdf = Buffer.from(await response.arrayBuffer())
      const after = await authenticatedDatabase.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM reports')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('content-disposition')).toContain('voice-map-demo-report.pdf')
      expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
      expect(response.headers.get('expires')).toBe('0')
      expect(response.headers.get('pragma')).toBe('no-cache')
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count)

      const protectedWorkspace = await fetch(`${baseUrl}/api/projects`)
      expect(protectedWorkspace.status).toBe(401)
      const demoSession = await getDemoAnalysisSession(database, created.data.token)
      expect(demoSession).not.toBeNull()
      const derivedBeforeExpiry = await database.query<{ signals: number; themes: number; jobs: number }>(
        `SELECT
          (SELECT COUNT(*)::int FROM review_signals WHERE analysis_run_id = $1) AS signals,
          (SELECT COUNT(*)::int FROM themes WHERE analysis_run_id = $1) AS themes,
          (SELECT COUNT(*)::int FROM llm_jobs WHERE analysis_run_id = $1) AS jobs`,
        [demoSession?.analysisRunId],
      )
      expect(derivedBeforeExpiry.rows[0]?.signals).toBeGreaterThan(0)
      expect(derivedBeforeExpiry.rows[0]?.themes).toBeGreaterThan(0)
      expect(derivedBeforeExpiry.rows[0]?.jobs).toBeGreaterThan(0)
      expect(await cleanupExpiredDemoAnalysisSessions(database, new Date(Date.now() + DEMO_RETENTION_MS + 1_000))).toBe(1)
      const derivedAfterExpiry = await database.query<{ projects: number; reviews: number; runs: number; signals: number; themes: number; jobs: number; sessions: number; curationSessions: number; curationActions: number }>(
        `SELECT
          (SELECT COUNT(*)::int FROM projects) AS projects,
          (SELECT COUNT(*)::int FROM reviews) AS reviews,
          (SELECT COUNT(*)::int FROM analysis_runs) AS runs,
          (SELECT COUNT(*)::int FROM review_signals) AS signals,
          (SELECT COUNT(*)::int FROM themes) AS themes,
          (SELECT COUNT(*)::int FROM llm_jobs) AS jobs,
          (SELECT COUNT(*)::int FROM demo_analysis_sessions) AS sessions,
          (SELECT COUNT(*)::int FROM curation_sessions) AS "curationSessions",
          (SELECT COUNT(*)::int FROM curation_actions) AS "curationActions"`,
      )
      expect(derivedAfterExpiry.rows[0]).toEqual({ projects: 0, reviews: 0, runs: 0, signals: 0, themes: 0, jobs: 0, sessions: 0, curationSessions: 0, curationActions: 0 })
    } finally {
      await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()))
      for (const key of [
        'GARAXE_LLM_ENRICHMENT_ENABLED', 'OPENCODE_GO_API_KEY', 'OPENCODE_GO_DEFAULT_MODEL', 'OPENCODE_GO_BASE_URL',
        'GARAXE_LLM_REQUEST_CAPACITY', 'GARAXE_LLM_REQUESTS_PER_SECOND', 'GARAXE_LLM_TOKEN_CAPACITY', 'GARAXE_LLM_TOKENS_PER_SECOND',
        'GARAXE_LLM_GLOBAL_CONCURRENCY', 'GARAXE_LLM_PROVIDER_CONCURRENCY', 'GARAXE_LLM_ORGANIZATION_CONCURRENCY',
        'GARAXE_LLM_MAX_OUTPUT_TOKENS', 'GARAXE_LLM_DEADLINE_MS',
      ]) delete process.env[key]
    }
  }, 30_000)

  it('reports the public demo unavailable without inspecting or returning a provider credential', async () => {
    authToken = ''
    const response = await fetch(`${baseUrl}/api/demo/analysis-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(demoCsvPayload(Array.from({ length: 6 }, () => 'A complete customer comment about progress visibility and trust.'))),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'DEMO_ANALYSIS_UNAVAILABLE' } })
  })

  it('rejects the removed manual demo payload before creating temporary state', async () => {
    authToken = ''
    const response = await fetch(`${baseUrl}/api/demo/analysis-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback: 'An arbitrary pasted comment must not enter the demo.' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'DEMO_INPUT_INVALID' } })
    const database = await getDemoDatabase()
    const sessions = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM demo_analysis_sessions')
    expect(sessions.rows[0]?.count).toBe(0)
  })

  it('restores an existing owner session only through the local development route', async () => {
    const response = await fetch(`${baseUrl}/api/auth/local-session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com' }),
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toMatch(/garaxe_session=.*HttpOnly.*SameSite=Strict/)
    expect(JSON.stringify(await response.json())).not.toContain('garaxe_session')
  })

  it('restores the configured staging owner without exposing the access key', async () => {
    process.env.GARAXE_DEPLOYMENT_TIER = 'staging'
    process.env.GARAXE_STAGING_AUTH_ENABLED = 'true'
    process.env.GARAXE_STAGING_OWNER_EMAIL = 'owner@example.com'
    process.env.GARAXE_STAGING_ACCESS_KEY = 'staging-access-key-with-32-characters'
    try {
      const status = await fetch(`${baseUrl}/api/auth/status`).then((response) => response.json())
      expect(status.data).toMatchObject({ needsBootstrap: false, stagingAccessEnabled: true })

      const rejected = await fetch(`${baseUrl}/api/auth/staging-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', accessKey: 'incorrect' }),
      })
      expect(rejected.status).toBe(401)

      const accepted = await fetch(`${baseUrl}/api/auth/staging-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', accessKey: process.env.GARAXE_STAGING_ACCESS_KEY }),
      })
      expect(accepted.status).toBe(201)
      expect(accepted.headers.get('set-cookie')).toContain('garaxe_session=')
      expect(JSON.stringify(await accepted.json())).not.toContain(process.env.GARAXE_STAGING_ACCESS_KEY)
    } finally {
      delete process.env.GARAXE_DEPLOYMENT_TIER
      delete process.env.GARAXE_STAGING_AUTH_ENABLED
      delete process.env.GARAXE_STAGING_OWNER_EMAIL
      delete process.env.GARAXE_STAGING_ACCESS_KEY
    }
  })

  it('never enables the legacy staging access-key route in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.GARAXE_DEPLOYMENT_TIER = 'staging'
    process.env.GARAXE_STAGING_AUTH_ENABLED = 'true'
    process.env.GARAXE_STAGING_OWNER_EMAIL = 'owner@example.com'
    process.env.GARAXE_STAGING_ACCESS_KEY = 'staging-access-key-with-32-characters'
    try {
      const status = await fetch(`${baseUrl}/api/auth/status`).then((response) => response.json())
      expect(status.data).toMatchObject({ stagingAccessEnabled: false })

      const response = await fetch(`${baseUrl}/api/auth/staging-session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', accessKey: process.env.GARAXE_STAGING_ACCESS_KEY }),
      })
      expect(response.status).toBe(404)
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      delete process.env.GARAXE_DEPLOYMENT_TIER
      delete process.env.GARAXE_STAGING_AUTH_ENABLED
      delete process.env.GARAXE_STAGING_OWNER_EMAIL
      delete process.env.GARAXE_STAGING_ACCESS_KEY
    }
  })

  it('closes bootstrap and legacy session routes when Supabase Auth is configured', async () => {
    process.env.SUPABASE_URL = 'https://voice-lab-test.supabase.co'
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
    try {
      for (const path of ['/api/auth/bootstrap', '/api/auth/local-session', '/api/auth/staging-session']) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
        })
        expect(response.status).toBe(404)
      }
    } finally {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_PUBLISHABLE_KEY
    }
  })

  it('creates and lists projects', async () => {
    const created = await post('/api/projects', { name: 'Northstar Clinics', primaryDecision: 'operations' })
    expect(created.status).toBe(201)
    const list = await apiFetch(`${baseUrl}/api/projects`).then((response) => response.json())
    expect(list.data[0]).toMatchObject({ name: 'Northstar Clinics', primaryDecision: 'operations' })
  })

  it('requires authentication and conceals projects across organizations', async () => {
    const project = await post('/api/projects', { name: 'Private project', primaryDecision: 'operations' }).then((response) => response.json())
    const unauthenticated = await fetch(`${baseUrl}/api/projects`)
    expect(unauthenticated.status).toBe(401)

    const database = await getDatabase()
    const outsider = await createIdentity(database, {
      email: 'outsider@example.com', displayName: 'Outsider', organizationName: 'Other Organization', role: 'viewer',
    })
    const outsiderSession = await createSession(database, outsider.userId)
    const headers = { authorization: `Bearer ${outsiderSession.token}` }
    const list = await fetch(`${baseUrl}/api/projects`, { headers }).then((response) => response.json())
    expect(list.data).toEqual([])
    const concealed = await fetch(`${baseUrl}/api/projects/${project.data.id}/reviews`, { headers })
    expect(concealed.status).toBe(404)
    expect(await concealed.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })
    const crossWorkspaceImport = await fetch(`${baseUrl}/api/imports`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.data.id, fileName: 'foreign.csv', rawCsv: 'review_text\nDenied',
        mapping: { review_text: 'review_text' },
      }),
    })
    expect(crossWorkspaceImport.status).toBe(404)
    expect(await crossWorkspaceImport.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })
    const foreignJobs = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM import_jobs WHERE project_id = $1', [project.data.id])
    expect(foreignJobs.rows[0].count).toBe(0)
  })

  it('applies one organization admission limit across active imports and analyses', async () => {
    process.env.GARAXE_ORGANIZATION_ACTIVE_JOB_LIMIT = '2'
    try {
      const project = await post('/api/projects', { name: 'Admission boundary', primaryDecision: 'research' }).then((response) => response.json())
      const database = await getDatabase()
      await database.query(
        `INSERT INTO import_jobs (id, project_id, file_name, status, total_rows) VALUES ($1,$2,'active.csv','processing',1)`,
        [randomUUID(), project.data.id],
      )
      await database.query(
        `INSERT INTO analysis_runs (id, project_id, objective, configuration, status, stage, pipeline_version)
         VALUES ($1,$2,'full_voice_map','{}','preprocessing','preprocessing','test')`,
        [randomUUID(), project.data.id],
      )
      const importResponse = await post('/api/imports', {
        projectId: project.data.id, fileName: 'manual.csv', rawCsv: 'review_text\nA safe manual comment long enough to import.', mapping: { review_text: 'review_text' },
      })
      const analysisResponse = await post('/api/analysis-runs', {
        projectId: project.data.id, configuration: { objective: 'full_voice_map' },
      })
      expect(importResponse.status).toBe(429)
      expect(await importResponse.json()).toMatchObject({ error: { code: 'ORGANIZATION_JOB_LIMIT_REACHED' } })
      expect(analysisResponse.status).toBe(429)
      expect(await analysisResponse.json()).toMatchObject({ error: { code: 'ORGANIZATION_JOB_LIMIT_REACHED' } })
    } finally {
      delete process.env.GARAXE_ORGANIZATION_ACTIVE_JOB_LIMIT
    }
  })

  it('rejects a second active analysis for the same project', async () => {
    const project = await post('/api/projects', { name: 'Single active analysis', primaryDecision: 'research' }).then((response) => response.json())
    const database = await getDatabase()
    await database.query(
      `INSERT INTO analysis_runs (id, project_id, objective, configuration, status, stage, pipeline_version)
       VALUES ($1,$2,'full_voice_map','{}','interpreting_clusters','interpreting_clusters','test')`,
      [randomUUID(), project.data.id],
    )

    const response = await post('/api/analysis-runs', {
      projectId: project.data.id, configuration: { objective: 'full_voice_map' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'PROJECT_ANALYSIS_ACTIVE' } })
    const runs = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM analysis_runs WHERE project_id = $1', [project.data.id])
    expect(runs.rows[0].count).toBe(1)
  })

  it('rejects unsafe and overlong CSV feedback before persisting executable source links or raw errors', async () => {
    const project = await post('/api/projects', { name: 'Manual input security', primaryDecision: 'research' }).then((response) => response.json())
    const unsafeCsv = 'review_id,source,review_text,source_url\nr1,test,"<img src=x onerror=alert(1)>",javascript:alert(1)'
    const unsafe = await post('/api/imports', {
      projectId: project.data.id, fileName: 'feedback.csv', rawCsv: unsafeCsv,
      mapping: detectMapping(parseCsv(unsafeCsv).headers),
    })
    expect(unsafe.status).toBe(400)
    expect(await unsafe.json()).toMatchObject({ error: { code: 'IMPORT_CONTENT_INVALID' } })
    const stored = await (await getDatabase()).query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM reviews WHERE project_id = $1`, [project.data.id],
    )
    expect(stored.rows[0].count).toBe(0)

    const markupCsv = 'review_id,source,review_text,source_url\nr2,test,"<script>alert(1)</script> is literal customer feedback.",https://example.com/reviews/1'
    const markup = await post('/api/imports', {
      projectId: project.data.id, fileName: 'feedback.csv', rawCsv: markupCsv,
      mapping: detectMapping(parseCsv(markupCsv).headers),
    }).then((response) => response.json())
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await apiFetch(`${baseUrl}/api/imports/${markup.data.id}`).then((response) => response.json())
      if (status.data.status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const retainedMarkup = await (await getDatabase()).query<{ body: string; sourceUrl: string }>(
      `SELECT body_original AS body, source_url AS "sourceUrl" FROM reviews WHERE project_id = $1`, [project.data.id],
    )
    expect(retainedMarkup.rows).toEqual([{
      body: '<script>alert(1)</script> is literal customer feedback.',
      sourceUrl: 'https://example.com/reviews/1',
    }])

    const longText = 'x'.repeat(10_001)
    const overlong = await post('/api/imports', {
      projectId: project.data.id, fileName: 'feedback.csv', rawCsv: `review_id,source,review_text\nr3,test,"${longText}"`,
      mapping: { review_id: 'review_id', source: 'source', review_text: 'review_text' },
    })
    expect(overlong.status).toBe(400)
    expect(await overlong.json()).toMatchObject({ error: { code: 'IMPORT_CONTENT_INVALID' } })
  })

  it('adds defensive API headers and rejects oversized request bodies', async () => {
    const live = await fetch(`${baseUrl}/api/live`)
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ status: 'alive' })

    const health = await fetch(`${baseUrl}/api/health`)
    expect(health.headers.get('x-content-type-options')).toBe('nosniff')
    expect(health.headers.get('cache-control')).toBe('no-store')

    process.env.GARAXE_MAX_BODY_BYTES = '100'
    try {
      const response = await apiFetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(200), primaryDecision: 'research' }),
      })
      expect(response.status).toBe(413)
      expect(await response.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    } finally {
      delete process.env.GARAXE_MAX_BODY_BYTES
    }

    const malformed = await apiFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({
      error: { code: 'REQUEST_BODY_INVALID', message: 'The request body must be valid JSON.' },
    })
  })

  it('starts a tenant-bound Google OAuth flow without exposing secrets', async () => {
    const project = await post('/api/projects', { name: 'Google project', primaryDecision: 'operations' }).then((response) => response.json())
    process.env.GOOGLE_CLIENT_ID = 'google-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'do-not-return-this-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1/callback'
    process.env.GARAXE_OAUTH_ENVELOPE_KEY = Buffer.alloc(32, 7).toString('base64')
    try {
      const response = await post('/api/connections/google/start', { projectId: project.data.id })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const authorization = new URL(payload.data.authorizationUrl)
      expect(authorization.origin).toBe('https://accounts.google.com')
      expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage')
      expect(authorization.searchParams.get('access_type')).toBe('offline')
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      expect(JSON.stringify(payload)).not.toContain(process.env.GOOGLE_CLIENT_SECRET)
      const stateRows = await (await getDatabase()).query<{ count: string }>('SELECT COUNT(*)::text AS count FROM google_oauth_states')
      expect(stateRows.rows[0].count).toBe('1')
    } finally {
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_SECRET
      delete process.env.GOOGLE_REDIRECT_URI
      delete process.env.GARAXE_OAUTH_ENVELOPE_KEY
    }
  })

  it('discovers, selects, and fully syncs authorized Google locations through HTTP resources', async () => {
    const provider = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      const path = request.url || ''
      if (path.startsWith('/account/v1/accounts')) return response.end(JSON.stringify({ accounts: [{ name: 'accounts/1', accountName: 'Acme Owner' }] }))
      if (path.startsWith('/info/v1/accounts/1/locations')) return response.end(JSON.stringify({ locations: [{ name: 'locations/1', title: 'Berlin Mitte' }] }))
      if (path.startsWith('/reviews/v4/accounts/1/locations/1/reviews')) return response.end(JSON.stringify({ reviews: [
        { reviewId: 'google-1', starRating: 'FIVE', comment: 'Kind staff and quick service', createTime: '2026-06-01T00:00:00Z', reviewReply: { comment: 'Thank you' } },
        { reviewId: 'google-2', starRating: 'TWO', createTime: '2026-06-02T00:00:00Z' },
      ] }))
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    try {
      const address = provider.address()
      if (!address || typeof address === 'string') throw new Error('Provider test server did not start.')
      const origin = `http://127.0.0.1:${address.port}`
      process.env.GOOGLE_ACCOUNT_MANAGEMENT_BASE_URL = `${origin}/account/v1`
      process.env.GOOGLE_BUSINESS_INFORMATION_BASE_URL = `${origin}/info/v1`
      process.env.GOOGLE_REVIEWS_BASE_URL = `${origin}/reviews/v4`
      const key = Buffer.alloc(32, 9)
      process.env.GARAXE_OAUTH_ENVELOPE_KEY = key.toString('base64')

      const project = await post('/api/projects', { name: 'Connected Google', primaryDecision: 'operations' }).then((response) => response.json())
      const database = await getDatabase()
      const owner = await database.query<{ userId: string; organizationId: string }>(
        `SELECT m.user_id AS "userId", po.organization_id AS "organizationId"
         FROM project_organizations po JOIN organization_memberships m ON m.organization_id = po.organization_id
         WHERE po.project_id = $1 LIMIT 1`, [project.data.id],
      )
      await saveGoogleConnection(database, {
        projectId: project.data.id, organizationId: owner.rows[0].organizationId, userId: owner.rows[0].userId,
        credentials: {
          encryptedAccessToken: encryptSecret('provider-access-token', key),
          encryptedRefreshToken: encryptSecret('provider-refresh-token', key),
          accessTokenExpiresAt: new Date(Date.now() + 60_000), grantedScope: 'https://www.googleapis.com/auth/business.manage',
          status: 'connected', capabilities: { canListAccounts: true, canListLocations: true, canReadReviews: true, canReadReplies: true, canWriteReplies: false },
        },
      })

      const discovered = await post(`/api/projects/${project.data.id}/connections/google/entities`, {}).then((response) => response.json())
      expect(discovered.data).toEqual(expect.arrayContaining([expect.objectContaining({ externalId: 'locations/1', name: 'Berlin Mitte', selected: false })]))
      const selected = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/connections/google/entities`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityExternalIds: ['locations/1'] }),
      }).then((response) => response.json())
      expect(selected.data).toEqual(expect.arrayContaining([expect.objectContaining({ externalId: 'locations/1', selected: true })]))
      const sync = await post(`/api/projects/${project.data.id}/connections/google/sync`, {}).then((response) => response.json())
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const job = await apiFetch(`${baseUrl}/api/imports/${sync.data.id}`).then((response) => response.json())
        if (job.data.status === 'completed') break
        if (job.data.status === 'failed') throw new Error(job.data.errorMessage)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const inventory = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?provider=google_business`).then((response) => response.json())
      expect(inventory.data.items).toHaveLength(2)
      expect(inventory.data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ externalReviewId: 'google-1', body: 'Kind staff and quick service', ownerReply: 'Thank you' }),
        expect.objectContaining({ externalReviewId: 'google-2', isRatingOnly: true }),
      ]))
    } finally {
      delete process.env.GOOGLE_ACCOUNT_MANAGEMENT_BASE_URL
      delete process.env.GOOGLE_BUSINESS_INFORMATION_BASE_URL
      delete process.env.GOOGLE_REVIEWS_BASE_URL
      delete process.env.GARAXE_OAUTH_ENVELOPE_KEY
      await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('persists raw rows, normalizes reviews, and completes an import job', async () => {
    const project = await post('/api/projects', { name: 'Acme Software', primaryDecision: 'positioning' }).then((response) => response.json())
    const parsed = parseCsv(sampleCsv)
    const created = await post('/api/imports', {
      projectId: project.data.id,
      fileName: 'reviews.csv',
      rawCsv: sampleCsv,
      mapping: detectMapping(parsed.headers),
    }).then((response) => response.json())

    let job: Record<string, unknown> = {}
    for (let attempt = 0; attempt < 50; attempt += 1) {
      job = (await apiFetch(`${baseUrl}/api/imports/${created.data.id}`).then((response) => response.json())).data
      if (job.status === 'completed' || job.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    expect(job).toMatchObject({ status: 'completed', usableRows: 7, duplicateRows: 0, invalidRows: 0 })
    const source = await (await getDatabase()).query<{ mediaType: string; encoding: string; content: Uint8Array; hash: string }>(
      `SELECT source_media_type AS "mediaType", source_encoding AS encoding, source_content AS content, source_hash AS hash
       FROM import_jobs WHERE id = $1`, [created.data.id],
    )
    expect(source.rows[0]).toMatchObject({ mediaType: 'text/csv', encoding: 'utf8', hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(Buffer.from(source.rows[0].content).toString('utf8')).toBe(sampleCsv)
    const reviews = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews`).then((response) => response.json())
    expect(reviews.data.items).toHaveLength(7)
    expect(reviews.data.items.every((review: { isRatingOnly: boolean }) => !review.isRatingOnly)).toBe(true)
  })

  it('retains identical text from distinct source records while deduplicating repeated IDs', async () => {
    const project = await post('/api/projects', { name: 'Import integrity', primaryDecision: 'quality' }).then((response) => response.json())
    const rawCsv = `review_id,source,rating,rating_scale,review_text,review_date
r1,test,2,5,"The delivery was late and the fries were cold and soggy.",2026-07-01
r4,test,1,5,"The delivery was late and the fries were cold and soggy.",2026-07-01
r4,test,4,5,"Duplicate external identifier with different text.",2026-07-02`
    const parsed = parseCsv(rawCsv)
    const created = await post('/api/imports', {
      projectId: project.data.id,
      fileName: 'unexpected-inputs.csv',
      rawCsv,
      mapping: detectMapping(parsed.headers),
    }).then((response) => response.json())

    let job: Record<string, unknown> = {}
    for (let attempt = 0; attempt < 50; attempt += 1) {
      job = (await apiFetch(`${baseUrl}/api/imports/${created.data.id}`).then((response) => response.json())).data
      if (job.status === 'completed' || job.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(job).toMatchObject({ status: 'completed', usableRows: 2, writtenRows: 2, ratingOnlyRows: 0, duplicateRows: 1, invalidRows: 0, errorMessage: null })
    const reviews = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews`).then((response) => response.json())
    expect(reviews.data.items).toHaveLength(2)
  })

  it('filters the inventory with parameterized server queries', async () => {
    const project = await post('/api/projects', { name: 'Inventory', primaryDecision: 'operations' }).then((response) => response.json())
    await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
r1,google_business,Berlin,5,"Wonderful staff and quick service",2026-01-10,en
r2,google_business,Hamburg,2,"Long painful wait",2026-02-15,en
r3,trustpilot,Berlin,4,"Schnelle Hilfe",2026-03-20,de
r4,trustpilot,Hamburg,3,"Average visit with little detail",2026-03-21,de
r5,csv_import,Berlin,1,"Painful billing problem",2025-12-01,en`)

    const filtered = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?provider=google_business&entity=Hamburg&rating_min=2&rating_max=2&date_from=2026-02-01&date_to=2026-02-28&language=en&has_text=true&search=painful`).then((response) => response.json())
    expect(filtered.data.items).toHaveLength(1)
    expect(filtered.data.items[0]).toMatchObject({ externalReviewId: 'r2', provider: 'google_business', entityName: 'Hamburg' })

    const ratingOnly = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?has_text=false`).then((response) => response.json())
    expect(ratingOnly.data.items).toHaveLength(0)
  })

  it('paginates reviews with a stable opaque cursor', async () => {
    const project = await post('/api/projects', { name: 'Pagination', primaryDecision: 'research' }).then((response) => response.json())
    await importCsv(project.data.id, `review_id,rating,review_text
p1,5,One
p2,4,Two
p3,3,Three
p4,2,Four
p5,1,Five`)

    const first = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?limit=2`).then((response) => response.json())
    expect(first.data).toMatchObject({ hasMore: true })
    expect(first.data.items).toHaveLength(2)
    expect(first.data.nextCursor).toEqual(expect.any(String))
    const second = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`).then((response) => response.json())
    expect(second.data.items).toHaveLength(2)
    expect(second.data.items.map((review: { id: string }) => review.id)).not.toEqual(expect.arrayContaining(first.data.items.map((review: { id: string }) => review.id)))
    const third = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?limit=2&cursor=${encodeURIComponent(second.data.nextCursor)}`).then((response) => response.json())
    expect(third.data).toMatchObject({ hasMore: false, nextCursor: null })
    expect(third.data.items).toHaveLength(1)
  })

  it('returns dataset breakdowns and exact import provenance', async () => {
    const project = await post('/api/projects', { name: 'Provenance', primaryDecision: 'quality' }).then((response) => response.json())
    const importJobId = await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language,custom_field
s1,google_business,Berlin,5,"Excellent care",2026-04-01,en,retained
s2,trustpilot,Hamburg,3,"Neutral visit with limited detail",2026-04-02,de,also-retained
s3,google_business,Berlin,1,"Slow response",2026-04-03,en,third`)

    const summary = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/review-summary`).then((response) => response.json())
    expect(summary.data).toMatchObject({ total: 3, writtenCount: 3, ratingOnlyCount: 0, providerCount: 2, entityCount: 2 })
    expect(summary.data.averageRating).toBe(3)
    expect(summary.data.breakdowns.providers).toEqual(expect.arrayContaining([
      { value: 'google_business', count: 2 }, { value: 'trustpilot', count: 1 },
    ]))

    const inventory = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?search=Excellent`).then((response) => response.json())
    const detail = await apiFetch(`${baseUrl}/api/reviews/${inventory.data.items[0].id}`).then((response) => response.json())
    expect(detail.data.review).toMatchObject({ externalReviewId: 's1', body: 'Excellent care' })
    expect(detail.data.sourceRecord).toMatchObject({ rowNumber: 2, rawPayload: expect.objectContaining({ custom_field: 'retained' }) })
    expect(detail.data.importJob).toMatchObject({ id: importJobId, fileName: 'inventory.csv', status: 'completed' })
  })

  it('rejects malformed inventory parameters', async () => {
    const project = await post('/api/projects', { name: 'Validation', primaryDecision: 'quality' }).then((response) => response.json())
    for (const query of ['limit=0', 'rating_min=nope', 'has_text=sometimes', 'cursor=broken']) {
      const response = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?${query}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'REVIEW_QUERY_INVALID' } })
    }
  })
})

async function readyCurationReportFixture(name: string) {
  const fixture = await createCurationFixture(name)
  const { session } = await createCuration(fixture.runId)
  const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
  const themes = projection.data.machineThemes as Array<{ id: string; evidence: Array<{ signalId: string }> }>
  expect(themes.length).toBeGreaterThan(0)
  await curate(session.id, 'edit_theme', { themeId: themes[0].id, name: 'Curated service experience', summary: 'A human-reviewed customer signal.' })
  await curate(session.id, 'pin_evidence', { themeId: themes[0].id, signalId: themes[0].evidence[0].signalId })
  await curate(session.id, 'approve_theme', { themeId: themes[0].id })
  for (const theme of themes.slice(1)) await curate(session.id, 'reject_theme', { themeId: theme.id })
  const ready = await curate(session.id, 'mark_ready')
  expect(ready.response.status).toBe(201)
  return { ...fixture, sessionId: session.id as string }
}

describe('immutable report snapshot API', () => {
  it('requires project ownership and a ready curation session', async () => {
    const fixture = await createCurationFixture('report-gates')
    const beforeCuration = await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId })
    expect(beforeCuration.status).toBe(409)
    expect(await beforeCuration.json()).toMatchObject({ error: { code: 'REPORT_CURATION_NOT_READY' } })

    const other = await post('/api/projects', { name: 'Other project', primaryDecision: 'research' }).then((response) => response.json())
    const mismatched = await post('/api/reports', { projectId: other.data.id, analysisRunId: fixture.runId })
    expect(mismatched.status).toBe(409)
    expect(await mismatched.json()).toMatchObject({ error: { code: 'REPORT_SCOPE_MISMATCH' } })

    const missing = await apiFetch(`${baseUrl}/api/reports/00000000-0000-0000-0000-000000000001`)
    expect(missing.status).toBe(404)
  })

  it('freezes curated narrative, versions, quality, and exact source evidence', async () => {
    const fixture = await readyCurationReportFixture('report-snapshot')
    const created = await post('/api/reports', {
      projectId: fixture.projectId,
      analysisRunId: fixture.runId,
      title: 'Customer language — approved',
    })
    expect(created.status).toBe(201)
    const report = (await created.json()).data
    expect(report).toMatchObject({
      projectId: fixture.projectId,
      analysisRunId: fixture.runId,
      curationSessionId: fixture.sessionId,
      version: 1,
      title: 'Customer language — approved',
      snapshot: {
        schemaVersion: 'report-snapshot-v2',
        project: { id: fixture.projectId, name: 'report-snapshot' },
        analysisRun: { id: fixture.runId, projectId: fixture.projectId, status: 'completed' },
        curation: { sessionId: fixture.sessionId, revision: expect.any(Number), readyAt: expect.anything() },
        versions: { pipeline: 'semantic-voice-map-v5', synthesis: expect.any(String), report: 'report-snapshot-v2' },
        dataset: { counts: expect.objectContaining({ found: 4 }), qualityReport: expect.any(Object), sourceCount: 1 },
        narrative: expect.objectContaining({ actions: expect.any(Array), provenance: expect.any(Object) }),
        charts: expect.objectContaining({ ratingDistribution: expect.any(Array), reviewTimeline: expect.any(Array), themePrevalence: expect.any(Array) }),
        themes: expect.arrayContaining([expect.objectContaining({
          name: 'Curated service experience',
          topic: expect.any(String),
          primaryCategory: expect.stringMatching(/^(pain|desired_outcome|objection|emotion|other)$/),
          primarySignalType: expect.stringMatching(/^(pain|desired_outcome|objection|emotion|other)$/),
          sentiment: expect.stringMatching(/^(positive|neutral|negative)$/),
          signalTaxonomyVersion: expect.any(String),
          summary: 'A human-reviewed customer signal.',
          evidence: expect.arrayContaining([expect.objectContaining({
            signalId: expect.any(String),
            reviewId: expect.any(String),
            quote: expect.any(String),
            quoteStart: expect.any(Number),
            quoteEnd: expect.any(Number),
            originalText: expect.any(String),
            provider: 'google_business',
            pinned: true,
          })]),
        })]),
      },
    })
    expect(report.snapshot.generatedAt).toBe(new Date(report.generatedAt).toISOString())

    const list = await apiFetch(`${baseUrl}/api/projects/${fixture.projectId}/reports`).then((response) => response.json())
    expect(list.data).toEqual([expect.objectContaining({ id: report.id, version: 1 })])
    expect(list.data[0]).not.toHaveProperty('snapshot')
    const detail = await apiFetch(`${baseUrl}/api/reports/${report.id}`).then((response) => response.json())
    expect(detail.data).toEqual(report)

    const pdfResponse = await apiFetch(`${baseUrl}/api/reports/${report.id}/pdf`)
    expect(pdfResponse.status).toBe(200)
    expect(pdfResponse.headers.get('content-type')).toBe('application/pdf')
    expect(pdfResponse.headers.get('content-disposition')).toContain('.pdf')
    expect(pdfResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(pdfResponse.headers.get('x-content-type-options')).toBe('nosniff')
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-')
  })

  it('creates distinct versions and never changes an old snapshot after new data, attempted actions, or a rerun', async () => {
    const fixture = await readyCurationReportFixture('report-immutability')
    const first = (await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId }).then((response) => response.json())).data
    const frozen = structuredClone(first.snapshot)

    const laterAction = await curate(fixture.sessionId, 'edit_theme', { themeId: first.snapshot.themes[0].originThemeIds[0], name: 'Changed later' })
    expect(laterAction.response.status).toBe(201)
    expect(laterAction.payload.data.projection.session.status).toBe('draft')

    await importCsv(fixture.projectId, `review_id,source,entity,rating,review_text,review_date,language
later-1,google_business,Berlin,1,"A newly imported complaint about very slow support",2026-06-01,en`)
    const rerun = await post('/api/analysis-runs', {
      projectId: fixture.projectId,
      configuration: { objective: 'full_voice_map', writtenOnly: true, minTextLength: 3 },
    }).then((response) => response.json())
    await waitForAnalysis(rerun.data.id)

    const oldAfterChanges = await apiFetch(`${baseUrl}/api/reports/${first.id}`).then((response) => response.json())
    expect(oldAfterChanges.data.snapshot).toEqual(frozen)
    expect((await curate(fixture.sessionId, 'mark_ready')).response.status).toBe(201)
    const second = (await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId }).then((response) => response.json())).data
    expect(second.id).not.toBe(first.id)
    expect(second.version).toBe(2)
    expect(second.snapshot.themes).not.toEqual(frozen.themes)
    expect(second.snapshot.themes[0]).toMatchObject({ name: 'Changed later', origin: 'user_curated', provenance: { createdBy: expect.any(String) } })
    expect(second.snapshot.curation.revision).toBeGreaterThan(frozen.curation.revision)

    const list = await apiFetch(`${baseUrl}/api/projects/${fixture.projectId}/reports`).then((response) => response.json())
    expect(list.data.map((report: { version: number }) => report.version).sort()).toEqual([1, 2])
  })
})

describe('immutable analysis dataset API (local MVP without authentication)', () => {
  it('validates configuration and project scope', async () => {
    const missingProject = await post('/api/analysis-runs', {
      projectId: '00000000-0000-0000-0000-000000000001',
      configuration: { objective: 'full_voice_map' },
    })
    expect(missingProject.status).toBe(404)

    const project = await post('/api/projects', { name: 'Analysis validation', primaryDecision: 'operations' }).then((response) => response.json())
    for (const configuration of [
      {},
      { objective: 'unknown' },
      { objective: 'full_voice_map', writtenOnly: 'yes' },
      { objective: 'full_voice_map', dateFrom: '2026-02-01', dateTo: '2026-01-01' },
      { objective: 'full_voice_map', ratings: [6] },
    ]) {
      const response = await post('/api/analysis-runs', { projectId: project.data.id, configuration })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'ANALYSIS_CONFIGURATION_INVALID' } })
    }
  })

  it('freezes configuration, persists every membership decision, and completes a quality report', async () => {
    const project = await post('/api/projects', { name: 'Dataset assembly', primaryDecision: 'operations' }).then((response) => response.json())
    await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
a1,google_business,Berlin,5,"Friendly staff and very quick support",2026-02-10,en
a2,google_business,Berlin,5,"A valid row outside the selected language",2026-02-11,fr
a3,google_business,Berlin,5,"No",2026-02-12,en
a4,google_business,Berlin,5,"Sehr guter Service",2026-02-13,de
a5,google_business,Berlin,5,"Excellent but old visit",2025-01-01,en
a6,google_business,Hamburg,5,"Excellent different branch",2026-02-14,en
a7,google_business,Berlin,2,"Painful low rating",2026-02-15,en`)
    const configuration = {
      objective: 'full_voice_map',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      entities: ['Berlin'],
      ratings: [5],
      languages: ['en'],
      writtenOnly: true,
      minTextLength: 5,
    }
    const createdResponse = await post('/api/analysis-runs', { projectId: project.data.id, configuration })
    expect(createdResponse.status).toBe(202)
    const created = await createdResponse.json()
    configuration.entities.push('Hamburg')
    const completed = await waitForAnalysis(created.data.id)
    expect(completed).toMatchObject({
      projectId: project.data.id,
      status: 'completed',
      stage: 'completed',
      pipelineVersion: 'semantic-voice-map-v5',
      configuration: { entities: ['Berlin'] },
      counts: { found: 7, included: 1, excluded: 6 },
      qualityReport: { found: 7, included: 1, excluded: 6 },
    })
    expect(completed.qualityReport.clusterInterpretation).toMatchObject({
      state: 'no_interpretation', engineVersion: 'deterministic-theme-engine-v2', acceptedThemes: 0,
    })

    const membership = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews`).then((response) => response.json())
    expect(membership.data).toHaveLength(7)
    expect(membership.data.filter((review: { inclusionStatus: string }) => review.inclusionStatus === 'included')).toHaveLength(1)
    expect(membership.data.filter((review: { inclusionStatus: string }) => review.inclusionStatus === 'excluded')).toHaveLength(6)
    expect(completed.counts.byReason).toMatchObject({
      user_excluded: 4,
      outside_date_range: 1,
      too_short: 1,
    })
    expect(completed.counts.byReason).not.toHaveProperty('included')

    const voiceMapResponse = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/voice-map`)
    expect(voiceMapResponse.status).toBe(200)
    const voiceMap = await voiceMapResponse.json()
    expect(voiceMap.data.artifact).toMatchObject({ validationThreshold: 1, voiceMap: { engineVersion: 'deterministic-theme-engine-v2' } })
    expect(voiceMap.data.themes).toHaveLength(0)
    expect(completed.qualityReport.semanticAnalysis).toMatchObject({
      segmentCount: 1, clusteredSegmentCount: 0, outlierCount: 1, clusterCount: 0,
    })

    const mutation = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ configuration: { entities: ['Hamburg'] } }),
    })
    expect(mutation.status).toBe(404)
    const unchanged = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}`).then((response) => response.json())
    expect(unchanged.data.configuration.entities).toEqual(['Berlin'])
  })

  it('filters incremental dated imports without overwriting, duplicating, or reusing stale run membership', async () => {
    const project = await post('/api/projects', { name: 'Incremental date filters', primaryDecision: 'operations' }).then((response) => response.json())
    await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
batch-1-start,csv_import,Lab,5,"January starts with a clear calibration request.",2026-01-01,en
batch-1-end,csv_import,Lab,4,"January ends with a distinct sensor complaint.",2026-01-31,en
batch-1-missing,csv_import,Lab,3,"This valid comment intentionally has no source date.",,en
`)
    await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
batch-2-start,csv_import,Clinic,5,"February starts with a scheduling outcome.",2026-02-01,en
batch-2-end,csv_import,Clinic,2,"February ends with a separate reservation problem.",2026-02-28,en
batch-1-end,csv_import,Lab,4,"A repeated external identifier must not duplicate the January review.",2026-02-10,en`)

    const summary = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/review-summary`).then((response) => response.json())
    expect(summary.data).toMatchObject({ total: 5, earliestDate: expect.stringContaining('2026-01-01'), latestDate: expect.stringContaining('2026-02-28') })

    const run = async (dateFrom?: string, dateTo?: string) => {
      const created = await post('/api/analysis-runs', {
        projectId: project.data.id,
        configuration: { objective: 'full_voice_map', dateFrom, dateTo, writtenOnly: true, minTextLength: 3 },
      }).then((response) => response.json())
      const completed = await waitForAnalysis(created.data.id)
      const membership = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews`).then((response) => response.json())
      return { completed, membership: membership.data }
    }

    const january = await run('2026-01-01', '2026-01-31')
    const february = await run('2026-02-01', '2026-02-28')
    const allDates = await run()
    expect(january.completed.counts).toMatchObject({ found: 5, included: 2, excluded: 3 })
    expect(february.completed.counts).toMatchObject({ found: 5, included: 2, excluded: 3 })
    expect(allDates.completed.counts).toMatchObject({ found: 5, included: 5, excluded: 0 })
    expect(january.membership.filter((item: { inclusionStatus: string }) => item.inclusionStatus === 'included').map((item: { originalText: string }) => item.originalText).sort()).toEqual([
      'January ends with a distinct sensor complaint.',
      'January starts with a clear calibration request.',
    ])
    expect(february.membership.filter((item: { inclusionStatus: string }) => item.inclusionStatus === 'included').map((item: { originalText: string }) => item.originalText).sort()).toEqual([
      'February ends with a separate reservation problem.',
      'February starts with a scheduling outcome.',
    ])
    expect(new Set(allDates.membership.map((item: { reviewId: string }) => item.reviewId)).size).toBe(5)
  })

  it('lists project-scoped runs and rejects bad run queries', async () => {
    const firstProject = await post('/api/projects', { name: 'First project', primaryDecision: 'research' }).then((response) => response.json())
    const secondProject = await post('/api/projects', { name: 'Second project', primaryDecision: 'research' }).then((response) => response.json())
    await importCsv(firstProject.data.id, 'review_id,rating,review_text\nr1,5,"Helpful and clear"')
    const created = await post('/api/analysis-runs', {
      projectId: firstProject.data.id,
      configuration: { objective: 'positive_language', writtenOnly: true, minTextLength: 3 },
    }).then((response) => response.json())
    await waitForAnalysis(created.data.id)

    const firstRuns = await apiFetch(`${baseUrl}/api/projects/${firstProject.data.id}/analysis-runs`).then((response) => response.json())
    const secondRuns = await apiFetch(`${baseUrl}/api/projects/${secondProject.data.id}/analysis-runs`).then((response) => response.json())
    expect(firstRuns.data).toHaveLength(1)
    expect(secondRuns.data).toHaveLength(0)
    expect(firstRuns.data[0]).toMatchObject({ id: created.data.id, objective: 'positive_language' })

    const missing = await apiFetch(`${baseUrl}/api/analysis-runs/00000000-0000-0000-0000-000000000001`)
    expect(missing.status).toBe(404)
    const invalidStatus = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews?inclusion_status=maybe`)
    expect(invalidStatus.status).toBe(400)
    const invalidLimit = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews?limit=0`)
    expect(invalidLimit.status).toBe(400)
  })
})

describe('append-only human curation API', () => {
  it('moves one aspect membership without moving its sibling and restores both exactly', async () => {
    const fixture = await createCurationFixture('curation-aspect-sibling')
    const database = await getDatabase()
    const before = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const [sourceTheme, targetTheme] = before.data.machineThemes.filter((theme: { evidence: unknown[] }) => theme.evidence.length > 0)
    const source = await database.query<{ signalId: string; reviewId: string; quote: string; quoteStart: number; quoteEnd: number }>(
      `SELECT id AS "signalId",review_id AS "reviewId",quote_text AS quote,quote_start AS "quoteStart",quote_end AS "quoteEnd"
       FROM review_signals WHERE id=$1`, [sourceTheme.evidence[0].signalId],
    )
    const sourceSignal = source.rows[0]!
    const siblingId = `${fixture.runId}:aspect-sibling`
    await database.query(
      `INSERT INTO review_signals
        (id,analysis_run_id,review_id,signal_type,label,normalized_aspect,sentiment,confidence,quote_text,quote_start,quote_end,attributes,extractor_version)
       SELECT $1,analysis_run_id,review_id,'desired_outcome','Sibling aspect','sibling aspect','neutral',.49,quote_text,quote_start,quote_end,
         $2::jsonb,extractor_version FROM review_signals WHERE id=$3`,
      [siblingId, '{}', sourceSignal.signalId],
    )
    await database.query(
      `INSERT INTO theme_evidence (theme_id,signal_id,review_id,evidence_strength,is_representative) VALUES ($1,$2,$3,.49,false)`,
      [targetTheme.id, siblingId, sourceSignal.reviewId],
    )
    const { session } = await createCuration(fixture.runId)
    const projected = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(projected.data.effectiveThemes.map((theme: { id: string }) => theme.id)).toEqual(expect.arrayContaining([sourceTheme.id, targetTheme.id]))
    const moved = await curate(session.id, 'move_evidence', {
      fromThemeId: sourceTheme.id, toThemeId: targetTheme.id, signalId: sourceSignal.signalId,
    })
    expect(moved.response.status, JSON.stringify(moved.payload)).toBe(201)
    const movedTarget = moved.payload.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === targetTheme.id)
    expect(movedTarget.evidence.filter((item: { reviewId: string }) => item.reviewId === sourceSignal.reviewId)
      .map((item: { signalId: string }) => item.signalId).sort()).toEqual([siblingId, sourceSignal.signalId].sort())
    const restored = await curate(session.id, 'restore_revision', { revision: 0 })
    const restoredSource = restored.payload.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === sourceTheme.id)
    const restoredTarget = restored.payload.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === targetTheme.id)
    expect(restoredSource.evidence.some((item: { signalId: string }) => item.signalId === sourceSignal.signalId)).toBe(true)
    expect(restoredTarget.evidence.some((item: { signalId: string }) => item.signalId === siblingId)).toBe(true)
    expect(restoredTarget.evidence.some((item: { signalId: string }) => item.signalId === sourceSignal.signalId)).toBe(false)
  })

  it('returns an evidence-cited overview brief without letting the model alter deterministic map data', async () => {
    const fixture = await createCurationFixture('overview-intelligence')
    const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const themeId = projection.data.effectiveThemes[0].id as string
    const provider = createServer(async (request, response) => {
      for await (const _ of request) { /* consume request */ }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        understood: { title: 'Customers need proof before switching.', narrative: 'The saved evidence points to one bounded adoption barrier.', themeIds: [themeId] },
        majorOpportunity: { title: 'Show the proof path', narrative: 'Make the successful handoff inspectable.', themeIds: [themeId] },
        majorRisk: { title: 'Trust can stall adoption', narrative: 'The concern remains visible in retained feedback.', themeIds: [themeId] },
        salesImplications: [{ title: 'Lead with evidence', narrative: 'Use the exact customer concern in sales enablement.', themeIds: [themeId] }],
        marketingImplications: [{ title: 'Show the evidence trail', narrative: 'Use the cited proof in campaign material.', themeIds: [themeId] }],
        nextActions: [
          { title: 'Publish a proof example', rationale: 'It answers the cited adoption barrier.', themeIds: [themeId] },
          { title: 'Equip sales with the source', rationale: 'The cited language clarifies the objection.', themeIds: [themeId] },
          { title: 'Measure the next run', rationale: 'Track whether the cited barrier recurs.', themeIds: [themeId] },
        ],
      }) } }], usage: {} }))
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (!address || typeof address === 'string') throw new Error('Overview provider did not start.')
    process.env.OPENCODE_GO_API_KEY = 'overview-test-key'
    process.env.OPENCODE_GO_BASE_URL = `http://127.0.0.1:${address.port}/v1`
    process.env.OPENCODE_GO_DEFAULT_MODEL = 'overview-test-model'
    try {
      const response = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/overview`)
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.data).toMatchObject({ status: 'ready', schemaVersion: 'overview-intelligence-v1' })
      expect(payload.data.brief.nextActions).toHaveLength(3)
      expect(JSON.stringify(payload.data.brief)).not.toContain('reviewCount')
      expect(payload.data.brief.nextActions.every((item: { themeIds: string[] }) => item.themeIds.every((id) => id === themeId))).toBe(true)
      expect(payload.data).not.toHaveProperty('provider')
      expect(payload.data).not.toHaveProperty('model')
    } finally {
      delete process.env.OPENCODE_GO_API_KEY
      delete process.env.OPENCODE_GO_BASE_URL
      delete process.env.OPENCODE_GO_DEFAULT_MODEL
      await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('does not complete or publish while a valid retained comment lacks a canonical outcome', async () => {
    const fixture = await createCurationFixture('incomplete-canonical-outcome')
    const database = await getDatabase()
    const organization = await database.query<{ organizationId: string }>(
      `SELECT organization_id AS "organizationId" FROM project_organizations WHERE project_id = $1`,
      [fixture.projectId],
    )
    const signals = await database.query<{ id: string; reviewId: string; quote: string; quoteStart: number; quoteEnd: number }>(
      `SELECT DISTINCT ON (review_id) id, review_id AS "reviewId", quote_text AS quote,
        quote_start AS "quoteStart", quote_end AS "quoteEnd"
       FROM review_signals WHERE analysis_run_id = $1 ORDER BY review_id, confidence DESC, id`,
      [fixture.runId],
    )
    for (const [index, signal] of signals.rows.entries()) {
      if (index === signals.rows.length - 1) continue
      await database.query(
        `UPDATE review_signals SET attributes = attributes || $3::jsonb WHERE id = $1 AND analysis_run_id = $2`,
        [signal.id, fixture.runId, JSON.stringify({ emergingInterpretation: {
          label: `Resolved signal ${index + 1}`, aspect: `resolved topic ${index + 1}`,
          topic: `resolved topic ${index + 1}`, primaryCategory: 'pain', signalTypes: ['pain'], sentiment: 'negative', confidence: .49,
          evidence: { reviewId: signal.reviewId, quoteText: signal.quote, quoteStart: signal.quoteStart, quoteEnd: signal.quoteEnd },
        } })],
      )
    }
    const jobId = randomUUID()
    await database.query(
      `INSERT INTO llm_jobs (
        id, organization_id, project_id, analysis_run_id, kind, provider, model,
        idempotency_key, input_digest, prompt_version, schema_version, routing_policy,
        state, estimated_input_tokens, max_output_tokens, requested_reservation_micro, completed_at
      ) VALUES ($1,$2,$3,$4,'emerging_signal_interpretation:test','test','test-model',$5,$5,'test','test','test',
        'fallback_completed',1,1,0,NOW())`,
      [jobId, organization.rows[0].organizationId, fixture.projectId, fixture.runId, `fallback-${jobId}`],
    )
    await database.query(
      `UPDATE analysis_runs SET status = 'interpreting_clusters', stage = 'interpreting_clusters', completed_at = NULL WHERE id = $1`,
      [fixture.runId],
    )

    await settleClusterInterpretationRuns(database)

    const run = await database.query<{ status: string; stage: string; completedAt: string | null }>(
      `SELECT status, stage, completed_at AS "completedAt" FROM analysis_runs WHERE id = $1`, [fixture.runId],
    )
    expect(run.rows[0]).toEqual({ status: 'failed', stage: 'failed', completedAt: null })
    expect((await post(`/api/analysis-runs/${fixture.runId}/curation-sessions`, {})).status).toBe(409)
    expect((await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId })).status).toBe(409)
  })

  it('uses one persisted per-comment outcome for coverage and Curation category/topic/evidence', async () => {
    const fixture = await createCurationFixture('canonical-outcome')
    const database = await getDatabase()
    const source = await database.query<{ signalId: string; reviewId: string; quote: string }>(
      `SELECT id AS "signalId", review_id AS "reviewId", quote_text AS quote
       FROM review_signals WHERE analysis_run_id = $1 ORDER BY id LIMIT 1`,
      [fixture.runId],
    )
    const signal = source.rows[0]!
    await database.query(
      `UPDATE review_signals SET attributes = attributes || $3::jsonb
       WHERE id = $1 AND analysis_run_id = $2`,
      [signal.signalId, fixture.runId, JSON.stringify({ canonicalOutcome: {
        label: 'Silent state distress', topic: 'silent task state', primaryCategory: 'emotion', primarySignalType: 'emotion',
        signalTaxonomyVersion: SIGNAL_TAXONOMY_VERSION, proposedTypeLabel: null,
        signalTypes: ['emotion'], sentiment: 'negative', confidence: .49,
        evidence: { reviewId: signal.reviewId, quoteText: signal.quote },
      } })],
    )
    await database.query('DELETE FROM theme_evidence WHERE signal_id = $1', [signal.signalId])

    const coverage = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/coverage`).then((response) => response.json())
    const covered = coverage.data.find((item: { reviewId: string }) => item.reviewId === signal.reviewId)
    expect(covered).toMatchObject({ signals: [{
      label: 'Silent state distress', category: 'emotion', sentiment: 'negative', quote: signal.quote,
    }], source: {
      provider: 'google_business', ratingScale: 5, language: 'en', sourceCreatedAt: expect.stringMatching(/^2026-/),
    } })

    const curation = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const bucket = curation.data.machineThemes.find((theme: { evidence: Array<{ signalId: string }> }) =>
      theme.evidence.some((item) => item.signalId === signal.signalId))
    expect(bucket).toMatchObject({ name: 'Silent state distress', topic: 'silent task state', type: 'emotion', categories: ['emotion'], sentiment: 'negative' })
    expect(bucket.evidence).toEqual([expect.objectContaining({ reviewId: signal.reviewId, quote: signal.quote })])
  })

  it('creates and restores a user-curated bucket from emerging source comments without relabeling it as model-confirmed', async () => {
    const fixture = await createCurationFixture('curation-emerging')
    const { session } = await createCuration(fixture.runId)
    const database = await getDatabase()
    const source = await database.query<{ reviewId: string }>('SELECT review_id AS "reviewId" FROM review_signals WHERE analysis_run_id = $1 ORDER BY id LIMIT 1', [fixture.runId])
    await database.query(
      `UPDATE review_signals SET attributes = attributes || $3::jsonb
       WHERE analysis_run_id = $1 AND review_id = $2`,
      [fixture.runId, source.rows[0].reviewId, JSON.stringify({ emergingInterpretation: { label: 'Engine setup friction', signalTypes: ['pain'] } })],
    )
    await database.query('DELETE FROM theme_evidence WHERE review_id = $1', [source.rows[0].reviewId])
    const coverage = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/coverage`).then((response) => response.json())
    const emerging = coverage.data.filter((item: { disposition: string }) => item.disposition === 'emerging')
    expect(emerging.length).toBeGreaterThan(0)

    const created = await curate(session.id, 'create_custom_theme', {
      name: 'Setup friction', summary: 'Analyst-created bucket for related setup feedback.', reviewIds: [emerging[0].reviewId],
    })
    expect(created.response.status).toBe(201)
    expect(created.payload.data.projection.effectiveThemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Setup friction', origin: 'user_curated', confidence: 'Emerging', provenance: expect.objectContaining({ sourceReviewIds: [emerging[0].reviewId], createdBy: expect.any(String) }) }),
    ]))
    expect(created.payload.data.action).toMatchObject({ actionType: 'create_custom_theme', sequence: 1 })
    const reassignedCoverage = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/coverage`).then((response) => response.json())
    expect(reassignedCoverage.data.find((item: { reviewId: string }) => item.reviewId === emerging[0].reviewId)).toMatchObject({ disposition: 'user_curated', reason: 'Moved by a person during Curation.' })

    const restored = await curate(session.id, 'restore_revision', { revision: 0 })
    expect(restored.response.status).toBe(201)
    expect(restored.payload.data.projection.effectiveThemes.some((theme: { name: string }) => theme.name === 'Setup friction')).toBe(false)
    expect(restored.payload.data.projection.actions.map((action: { actionType: string }) => action.actionType)).toEqual(['create_custom_theme', 'restore_revision'])
  })

  it('restores an approved bucket to its pending machine state at revision zero', async () => {
    const fixture = await createCurationFixture('curation-approve-restore')
    const { session } = await createCuration(fixture.runId)
    const initial = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const theme = initial.data.machineThemes.find((item: { status: string }) => item.status === 'pending')

    const approved = await curate(session.id, 'approve_theme', { themeId: theme.id })
    expect(approved.payload.data.projection.machineThemes.find((item: { id: string }) => item.id === theme.id).status).toBe('approved')

    const restored = await curate(session.id, 'restore_revision', { revision: 0 })
    expect(restored.response.status).toBe(201)
    expect(restored.payload.data.projection.machineThemes.find((item: { id: string }) => item.id === theme.id).status).toBe('pending')
  })

  it('keeps the machine proposal immutable when an analyst edits the effective bucket', async () => {
    const fixture = await createCurationFixture('curation-machine-proposal')
    const { session } = await createCuration(fixture.runId)
    const initial = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const machine = initial.data.machineThemes[0]

    const edited = await curate(session.id, 'edit_theme', {
      themeId: machine.id,
      name: 'Analyst interpretation',
      summary: 'A reversible human correction.',
    })
    expect(edited.payload.data.projection.effectiveThemes.find((item: { id: string }) => item.id === machine.id)).toMatchObject({
      name: 'Analyst interpretation', summary: 'A reversible human correction.',
    })
    expect(edited.payload.data.projection.machineThemes.find((item: { id: string }) => item.id === machine.id)).toMatchObject({
      name: machine.name, summary: machine.summary,
    })
  })

  it('restores the immediately preceding visible revision after an earlier restore', async () => {
    const fixture = await createCurationFixture('curation-chained-restore')
    const { session } = await createCuration(fixture.runId)
    const initial = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const theme = initial.data.machineThemes.find((item: { evidence: unknown[] }) => item.evidence.length >= 2)
    const originalName = theme.name
    const [first, second] = theme.evidence

    await curate(session.id, 'edit_theme', { themeId: theme.id, name: 'Temporary renamed bucket', summary: theme.summary })
    await curate(session.id, 'restore_revision', { revision: 0 })
    await curate(session.id, 'split_theme', {
      themeId: theme.id,
      groups: [
        { name: 'First temporary split', signalIds: [first.signalId] },
        { name: 'Second temporary split', signalIds: [second.signalId] },
      ],
    })
    const restored = await curate(session.id, 'restore_revision', { revision: 2 })

    const effective = restored.payload.data.projection.effectiveThemes
    expect(effective.find((item: { id: string }) => item.id === theme.id)).toMatchObject({ name: originalName })
    expect(effective.some((item: { name: string }) => item.name === 'Temporary renamed bucket')).toBe(false)
    expect(effective.some((item: { name: string }) => item.name.includes('temporary split'))).toBe(false)
  })

  it('reassigns represented singleton evidence into a reversible custom bucket exactly once', async () => {
    const fixture = await createCurationFixture('curation-represented-singleton')
    const database = await getDatabase()
    const source = await database.query<{ themeId: string; signalId: string; reviewId: string }>(
      `SELECT te.theme_id AS "themeId", te.signal_id AS "signalId", te.review_id AS "reviewId"
       FROM theme_evidence te JOIN themes t ON t.id = te.theme_id
       WHERE t.analysis_run_id = $1 ORDER BY te.theme_id, te.signal_id LIMIT 1`,
      [fixture.runId],
    )
    const selected = source.rows[0]!
    await database.query('DELETE FROM theme_evidence WHERE theme_id = $1 AND signal_id <> $2', [selected.themeId, selected.signalId])
    const { session } = await createCuration(fixture.runId)
    const before = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(before.data.machineThemes.find((theme: { id: string }) => theme.id === selected.themeId).evidence).toEqual([
      expect.objectContaining({ signalId: selected.signalId, reviewId: selected.reviewId }),
    ])

    const created = await curate(session.id, 'create_custom_theme', {
      name: 'Reviewed singleton', summary: 'Reassigned from its engine bucket.', reviewIds: [selected.reviewId],
    })
    expect(created.response.status).toBe(201)
    const custom = created.payload.data.projection.effectiveThemes.find((theme: { name: string }) => theme.name === 'Reviewed singleton')
    expect(custom).toMatchObject({
      origin: 'user_curated', evidence: [expect.objectContaining({ signalId: selected.signalId, reviewId: selected.reviewId })],
      provenance: { sourceReviewIds: [selected.reviewId], createdBy: expect.any(String), createdAt: expect.any(String) },
    })
    const occurrences = created.payload.data.projection.effectiveThemes.flatMap((theme: { evidence: Array<{ signalId: string }> }) =>
      theme.evidence.filter((item) => item.signalId === selected.signalId))
    expect(occurrences).toHaveLength(1)
    expect(created.payload.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === selected.themeId).evidence).toEqual([])
    expect(created.payload.data.projection.machineThemes.some((theme: { id: string }) => theme.id === selected.themeId)).toBe(false)
    const coverage = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/coverage`).then((response) => response.json())
    expect(coverage.data.find((item: { reviewId: string }) => item.reviewId === selected.reviewId)).toMatchObject({ disposition: 'user_curated' })

    const restored = await curate(session.id, 'restore_revision', { revision: 0 })
    expect(restored.response.status).toBe(201)
    expect(restored.payload.data.projection.effectiveThemes.some((theme: { name: string }) => theme.name === 'Reviewed singleton')).toBe(false)
    expect(restored.payload.data.projection.effectiveThemes.find((theme: { id: string }) => theme.id === selected.themeId).evidence).toEqual([
      expect.objectContaining({ signalId: selected.signalId, reviewId: selected.reviewId }),
    ])
  })

  it('rejects unauthenticated and cross-workspace custom-bucket reassignment', async () => {
    const local = await createCurationFixture('curation-local-scope')
    const foreign = await createCurationFixture('curation-foreign-scope')
    const { session } = await createCuration(local.runId)
    const database = await getDatabase()
    const localReview = await database.query<{ reviewId: string }>(
      `SELECT te.review_id AS "reviewId" FROM theme_evidence te JOIN themes t ON t.id = te.theme_id
       WHERE t.analysis_run_id = $1 ORDER BY te.review_id LIMIT 1`, [local.runId],
    )
    const foreignReview = await database.query<{ reviewId: string }>(
      `SELECT te.review_id AS "reviewId" FROM theme_evidence te JOIN themes t ON t.id = te.theme_id
       WHERE t.analysis_run_id = $1 ORDER BY te.review_id LIMIT 1`, [foreign.runId],
    )

    const token = authToken
    authToken = ''
    const unauthorized = await curate(session.id, 'create_custom_theme', {
      name: 'Unauthorized', summary: 'Must not be created.', reviewIds: [localReview.rows[0]!.reviewId],
    })
    authToken = token
    expect(unauthorized.response.status).toBe(401)

    const crossWorkspace = await curate(session.id, 'create_custom_theme', {
      name: 'Foreign evidence', summary: 'Must not cross workspace scope.', reviewIds: [foreignReview.rows[0]!.reviewId],
    })
    expect(crossWorkspace.response.status).toBe(404)
    expect(crossWorkspace.payload.error.code).toBe('CURATION_EVIDENCE_NOT_FOUND')
  })

  it('creates one run-scoped session and projects edit, pin, exclude, split, approve, reject, and readiness actions', async () => {
    const fixture = await createCurationFixture('curation-actions')
    const [first, second] = await Promise.all([createCuration(fixture.runId), createCuration(fixture.runId)])
    expect([first.response.status, second.response.status].sort()).toEqual([200, 201])
    expect(first.session).toMatchObject({ analysisRunId: fixture.runId, status: 'draft', revision: 0 })
    expect(second.session.id).toBe(first.session.id)

    const initial = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(initial.data.readiness).toMatchObject({
      validatedMachineThemes: expect.any(Number),
      resolved: 0,
      publishable: 0,
      canMarkReady: false,
    })
    expect(initial.data.readiness.validatedMachineThemes).toBeGreaterThanOrEqual(2)
    const splittable = initial.data.machineThemes.find((theme: { evidence: unknown[] }) => theme.evidence.length >= 2)
    expect(splittable).toBeTruthy()
    const [firstEvidence, secondEvidence] = splittable.evidence
    expect(firstEvidence.originalText.slice(firstEvidence.quoteStart, firstEvidence.quoteEnd)).toBe(firstEvidence.quote)
    expect(firstEvidence.originalText.length).toBeGreaterThanOrEqual(firstEvidence.quote.length)

    expect((await curate(first.session.id, 'edit_theme', {
      themeId: splittable.id,
      name: 'A warmer welcome',
      summary: 'Human-authored interpretation.',
    })).response.status).toBe(201)
    expect((await curate(first.session.id, 'pin_evidence', { themeId: splittable.id, signalId: firstEvidence.signalId })).response.status).toBe(201)
    expect((await curate(first.session.id, 'exclude_evidence', { themeId: splittable.id, signalId: firstEvidence.signalId })).response.status).toBe(201)

    const overlap = await curate(first.session.id, 'split_theme', {
      themeId: splittable.id,
      groups: [
        { name: 'First group', signalIds: [firstEvidence.signalId] },
        { name: 'Overlap', signalIds: [firstEvidence.signalId] },
      ],
    })
    expect(overlap.response.status).toBe(400)
    expect(overlap.payload).toMatchObject({ error: { code: 'CURATION_SPLIT_OVERLAP' } })

    const split = await curate(first.session.id, 'split_theme', {
      themeId: splittable.id,
      groups: [
        { name: 'Friendly welcome', signalIds: [firstEvidence.signalId] },
        { name: 'Helpful interaction', signalIds: [secondEvidence.signalId] },
      ],
    })
    expect(split.response.status).toBe(201)
    expect(split.payload.data.projection.effectiveThemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: splittable.id, name: 'A warmer welcome', summary: 'Human-authored interpretation.', status: 'consumed' }),
      expect.objectContaining({ name: 'Friendly welcome', status: 'approved' }),
      expect.objectContaining({ name: 'Helpful interaction', status: 'approved' }),
    ]))
    expect(split.payload.data.projection.machineThemes.find((theme: { id: string }) => theme.id === splittable.id)).toMatchObject({
      name: splittable.name,
      summary: splittable.summary,
      status: 'consumed',
    })

    const pending = split.payload.data.projection.machineThemes.filter((theme: { status: string }) => theme.status === 'pending')
    for (const [index, theme] of pending.entries()) {
      const result = await curate(first.session.id, index === 0 ? 'approve_theme' : 'reject_theme', { themeId: theme.id })
      expect(result.response.status).toBe(201)
    }
    const beforeReady = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(beforeReady.data.readiness).toMatchObject({ pending: 0, canMarkReady: true })
    expect(beforeReady.data.readiness.publishable).toBeGreaterThan(0)

    const ready = await curate(first.session.id, 'mark_ready')
    expect(ready.response.status).toBe(201)
    expect(ready.payload.data.projection).toMatchObject({
      session: { status: 'ready' },
      readiness: { pending: 0, canMarkReady: true, isReady: true },
    })
    const afterReady = await curate(first.session.id, 'restore_revision', { revision: ready.payload.data.projection.session.revision - 1 })
    expect(afterReady.response.status).toBe(201)
    expect(afterReady.payload.data.projection.session.status).toBe('draft')

    const historyResponse = await apiFetch(`${baseUrl}/api/curation-sessions/${first.session.id}/actions`)
    expect(historyResponse.status).toBe(200)
    const history = await historyResponse.json()
    expect(history.data.map((action: { actionType: string }) => action.actionType)).toEqual([
      'edit_theme', 'pin_evidence', 'exclude_evidence', 'split_theme',
      ...pending.map((_: unknown, index: number) => index === 0 ? 'approve_theme' : 'reject_theme'),
      'mark_ready', 'restore_revision',
    ])
    expect(history.data.map((action: { sequence: number }) => action.sequence)).toEqual(
      Array.from({ length: history.data.length }, (_, index) => index + 1),
    )

    const machineAfter = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/voice-map`).then((response) => response.json())
    expect(machineAfter.data.themes).toEqual(fixture.voiceMap.themes)
  })

  it('projects accepted LLM interpretation into curation while retaining full source feedback', async () => {
    const fixture = await createCurationFixture('curation-interpretation')
    const sourceTheme = fixture.voiceMap.themes.find((theme: { validation: { status: string } }) => theme.validation.status === 'validated')
    expect(sourceTheme).toBeTruthy()
    const database = await getDatabase()
    await database.query(
      `UPDATE themes SET validation = validation || $2::jsonb WHERE id = $1`,
      [sourceTheme.id, JSON.stringify({ interpretationCandidate: {
        label: 'Helpful staff response', evaluation: 'praise', rootCause: 'Staff were friendly and helpful',
        consequence: 'Customers felt welcomed', signalTypes: ['praise'], confidence: .9,
        publicationAction: 'publish', publicationReason: null,
      } })],
    )
    await database.query(
      `UPDATE analysis_runs SET status = 'interpreting_clusters', stage = 'interpreting_clusters', completed_at = NULL WHERE id = $1`,
      [fixture.runId],
    )
    const organization = await database.query<{ organizationId: string }>(
      `SELECT organization_id AS "organizationId" FROM project_organizations WHERE project_id = $1`,
      [fixture.projectId],
    )
    const queuedJobId = randomUUID()
    await database.query(
      `INSERT INTO llm_jobs (
        id, organization_id, project_id, analysis_run_id, kind, provider, model,
        idempotency_key, input_digest, prompt_version, schema_version, routing_policy,
        state, estimated_input_tokens, max_output_tokens, requested_reservation_micro
      ) VALUES ($1, $2, $3, $4, $5, 'test', 'test-model', $6, $7, 'test-v1', 'test-v1', 'test-v1', 'queued', 1, 1, 0)`,
      [queuedJobId, organization.rows[0].organizationId, fixture.projectId, fixture.runId,
        `${CLUSTER_INTERPRETATION_JOB_KIND}:${sourceTheme.id}`, `queued-${queuedJobId}`, queuedJobId],
    )
    await settleClusterInterpretationRuns(database)
    const waiting = await database.query<{ status: string }>(
      `SELECT status FROM analysis_runs WHERE id = $1`,
      [fixture.runId],
    )
    expect(waiting.rows[0].status).toBe('interpreting_clusters')
    const visibleProgress = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}`).then((response) => response.json())
    expect(visibleProgress.data).toMatchObject({
      status: 'interpreting_clusters',
      llmProgress: { total: 1, queued: 1, completed: 0, remaining: 1, percent: 0, interpretedThemes: 1 },
    })
    await database.query(
      `UPDATE llm_jobs SET state = 'succeeded', completed_at = NOW() WHERE id = $1`,
      [queuedJobId],
    )
    await settleClusterInterpretationRuns(database)
    const settled = await database.query<{ status: string; qualityReport: Record<string, unknown> }>(
      `SELECT status, quality_report AS "qualityReport" FROM analysis_runs WHERE id = $1`,
      [fixture.runId],
    )
    expect(settled.rows[0]).toMatchObject({
      status: 'completed',
      qualityReport: { clusterInterpretation: { engineVersion: LLM_INTERPRETED_ENGINE_VERSION, acceptedThemes: 1 } },
    })
    const completedProgress = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}`).then((response) => response.json())
    expect(completedProgress.data.llmProgress).toMatchObject({
      total: 1, succeeded: 1, completed: 1, remaining: 0, percent: 100, interpretedThemes: 1,
    })
    const voiceMap = await database.query<{ synthesisVersion: string }>(
      `SELECT synthesis_version AS "synthesisVersion" FROM voice_maps WHERE analysis_run_id = $1`,
      [fixture.runId],
    )
    expect(voiceMap.rows[0].synthesisVersion).toBe(LLM_INTERPRETED_ENGINE_VERSION)
    const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const interpreted = projection.data.machineThemes.find((theme: { id: string }) => theme.id === sourceTheme.id)
    expect(interpreted).toMatchObject({
      name: 'Helpful staff response', summary: 'Root cause: Staff were friendly and helpful. Consequence: Customers felt welcomed.',
      type: 'praise', sentiment: 'positive', signalTypes: ['praise'], categories: ['desired_outcome'],
    })
    expect(interpreted.evidence[0].originalText.slice(interpreted.evidence[0].quoteStart, interpreted.evidence[0].quoteEnd))
      .toBe(interpreted.evidence[0].quote)
  })

  it('keeps retained LLM-discarded feedback visible in the curation queue', async () => {
    const fixture = await createCurationFixture('curation-publication-gate')
    const sourceTheme = fixture.voiceMap.themes.find((theme: { validation: { status: string } }) => theme.validation.status === 'validated')
    expect(sourceTheme).toBeTruthy()
    const database = await getDatabase()
    await database.query(
      `UPDATE themes SET validation = validation || $2::jsonb WHERE id = $1`,
      [sourceTheme.id, JSON.stringify({ status: 'insufficient_evidence', interpretationCandidate: {
        label: 'Irrelevant session context', evaluation: 'mixed', rootCause: null, consequence: null,
        signalTypes: ['pain'], confidence: .98, publicationAction: 'discard',
        publicationReason: 'Repeated session boilerplate joins unrelated product feedback.',
      } })],
    )
    const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(projection.data.machineThemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceTheme.id, name: 'Irrelevant session context', status: 'pending' }),
    ]))
    expect(projection.data.readiness.validatedMachineThemes).toBe(projection.data.machineThemes.filter((theme: { validationStatus: string }) => theme.validationStatus === 'validated').length)
    const { session } = await createCuration(fixture.runId)
    const edited = await curate(session.id, 'edit_theme', { themeId: sourceTheme.id, name: 'Needs human grouping' })
    expect(edited.response.status).toBe(201)
    expect(edited.payload.data.projection.effectiveThemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceTheme.id, name: 'Needs human grouping', origin: 'user_curated' }),
    ]))
  })

  it('admits publishable and retained unresolved interpretations to an LLM curation queue', async () => {
    const fixture = await createCurationFixture('curation-llm-publication-boundary')
    const validated = fixture.voiceMap.themes.filter((theme: { validation: { status: string } }) => theme.validation.status === 'validated')
    expect(validated.length).toBeGreaterThanOrEqual(2)
    const [publishable, unresolvedSplit] = validated
    const database = await getDatabase()
    await database.query(
      `UPDATE voice_maps SET synthesis_version = $2 WHERE analysis_run_id = $1`,
      [fixture.runId, LLM_INTERPRETED_ENGINE_VERSION],
    )
    await database.query(
      `UPDATE themes SET validation = validation || $2::jsonb WHERE id = $1`,
      [publishable.id, JSON.stringify({ interpretationCandidate: {
        label: 'Reliable published interpretation', evaluation: 'praise', rootCause: 'Customers describe a reliable result',
        consequence: null, signalTypes: ['praise'], confidence: .91, publicationAction: 'publish', publicationReason: null,
        groupingAction: 'keep', groupingReason: null,
      } })],
    )
    await database.query(
      `UPDATE themes SET validation = validation || $2::jsonb WHERE id = $1`,
      [unresolvedSplit.id, JSON.stringify({ interpretationCandidate: {
        label: 'Mixed unrelated feedback', evaluation: 'mixed', rootCause: null, consequence: null,
        signalTypes: ['pain'], confidence: .84, publicationAction: 'publish', publicationReason: null,
        groupingAction: 'split', groupingReason: 'Evidence contains unrelated product issues.',
      } })],
    )

    const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(projection.data.machineThemes.map((theme: { id: string }) => theme.id)).toEqual(expect.arrayContaining([publishable.id, unresolvedSplit.id]))
    expect(projection.data.machineThemes[0]).toMatchObject({ name: 'Reliable published interpretation', status: 'pending' })
    expect(projection.data.machineThemes.find((theme: { id: string }) => theme.id === unresolvedSplit.id)).toMatchObject({
      name: 'Mixed unrelated feedback',
      status: 'pending',
      groupingSuggestion: { action: 'split', reason: 'Evidence contains unrelated product issues.' },
    })
    expect(projection.data.readiness).toMatchObject({ validatedMachineThemes: 2, pending: 2 })
  })

  it('merges themes, enforces the ready gate, and retains at least one publishable effective theme', async () => {
    const fixture = await createCurationFixture('curation-merge')
    const { session } = await createCuration(fixture.runId)
    const initial = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    const themes = initial.data.machineThemes

    const premature = await curate(session.id, 'mark_ready')
    expect(premature.response.status).toBe(409)
    expect(premature.payload).toMatchObject({ error: { code: 'CURATION_READY_GATE_FAILED' } })
    const oneTheme = await curate(session.id, 'merge_themes', { themeIds: [themes[0].id] })
    expect(oneTheme.response.status).toBe(400)

    const merged = await curate(session.id, 'merge_themes', {
      themeIds: [themes[0].id, themes[1].id],
      name: 'Combined customer tension',
      summary: 'Two related signals reviewed together.',
    })
    expect(merged.response.status).toBe(201)
    expect(merged.payload.data.projection.effectiveThemes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Combined customer tension', status: 'approved', publishable: true }),
    ]))
    const unresolved = merged.payload.data.projection.machineThemes.filter((theme: { status: string }) => theme.status === 'pending')
    for (const theme of unresolved) await curate(session.id, 'reject_theme', { themeId: theme.id })
    const ready = await curate(session.id, 'mark_ready')
    expect(ready.response.status).toBe(201)
    expect(ready.payload.data.projection.readiness).toMatchObject({
      pending: 0,
      consumed: 2,
      publishable: 1,
      isReady: true,
    })
  })

  it('rejects cross-run theme/evidence identifiers and preserves curation across a later analysis run', async () => {
    const first = await createCurationFixture('curation-run-one')
    const secondCreated = await post('/api/analysis-runs', {
      projectId: first.projectId,
      configuration: { objective: 'full_voice_map', writtenOnly: true, minTextLength: 3 },
    }).then((response) => response.json())
    await waitForAnalysis(secondCreated.data.id)
    const second = { runId: secondCreated.data.id as string }
    const firstSession = (await createCuration(first.runId)).session
    const firstProjection = await apiFetch(`${baseUrl}/api/analysis-runs/${first.runId}/curation`).then((response) => response.json())
    const secondProjection = await apiFetch(`${baseUrl}/api/analysis-runs/${second.runId}/curation`).then((response) => response.json())
    const firstTheme = firstProjection.data.machineThemes[0]
    const secondTheme = secondProjection.data.machineThemes[0]

    const foreignTheme = await curate(firstSession.id, 'approve_theme', { themeId: secondTheme.id })
    expect(foreignTheme.response.status).toBe(404)
    expect(foreignTheme.payload).toMatchObject({ error: { code: 'CURATION_THEME_NOT_FOUND' } })
    const foreignEvidence = await curate(firstSession.id, 'pin_evidence', {
      themeId: firstTheme.id,
      signalId: secondTheme.evidence[0].signalId,
    })
    expect(foreignEvidence.response.status).toBe(404)
    expect(foreignEvidence.payload).toMatchObject({ error: { code: 'CURATION_EVIDENCE_NOT_FOUND' } })

    expect((await curate(firstSession.id, 'approve_theme', { themeId: firstTheme.id })).response.status).toBe(201)
    const before = await apiFetch(`${baseUrl}/api/analysis-runs/${first.runId}/curation`).then((response) => response.json())
    const secondSession = await createCuration(second.runId)
    expect(secondSession.session.id).not.toBe(firstSession.id)
    const after = await apiFetch(`${baseUrl}/api/analysis-runs/${first.runId}/curation`).then((response) => response.json())
    expect(after.data.actions).toEqual(before.data.actions)
    expect(after.data.machineThemes).toEqual(before.data.machineThemes)
  })
})
