// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleRequest } from './app'
import { getDatabase, resetDatabaseForTests } from './db'
import { createIdentity, createSession } from './auth'
import { encryptSecret } from './googleOAuth'
import { saveGoogleConnection } from './googleConnections'
import {
  CLUSTER_INTERPRETATION_JOB_KIND,
  LLM_INTERPRETED_ENGINE_VERSION,
  settleClusterInterpretationRuns,
} from './clusterInterpretation'
import { detectMapping, parseCsv, sampleCsv } from '../src/lib/csv'

let server: Server
let baseUrl = ''
let authToken = ''

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

async function importCsv(projectId: string, rawCsv: string) {
  const parsed = parseCsv(rawCsv)
  const created = await post('/api/imports', {
    projectId,
    fileName: 'inventory.csv',
    rawCsv,
    mapping: detectMapping(parsed.headers),
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

    expect(job).toMatchObject({ status: 'completed', usableRows: 5, duplicateRows: 1, invalidRows: 1 })
    const source = await (await getDatabase()).query<{ mediaType: string; encoding: string; content: Uint8Array; hash: string }>(
      `SELECT source_media_type AS "mediaType", source_encoding AS encoding, source_content AS content, source_hash AS hash
       FROM import_jobs WHERE id = $1`, [created.data.id],
    )
    expect(source.rows[0]).toMatchObject({ mediaType: 'text/csv', encoding: 'utf8', hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(Buffer.from(source.rows[0].content).toString('utf8')).toBe(sampleCsv)
    const reviews = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews`).then((response) => response.json())
    expect(reviews.data.items).toHaveLength(5)
    expect(reviews.data.items.some((review: { isRatingOnly: boolean }) => review.isRatingOnly)).toBe(true)
  })

  it('completes safely while excluding malformed dates, out-of-scale ratings, duplicate text, and duplicate IDs', async () => {
    const project = await post('/api/projects', { name: 'Import integrity', primaryDecision: 'quality' }).then((response) => response.json())
    const rawCsv = `review_id,rating,rating_scale,review_text,review_date
r1,2,5,"The delivery was late and the fries were cold and soggy.",2026-07-01
r2,7,5,"Rating exceeds the source scale.",2026-07-01
r3,3,5,"Malformed source date should not reach PostgreSQL.",not-a-date
r4,1,5,"The delivery was late and the fries were cold and soggy.",2026-07-01
r4,4,5,"Duplicate external identifier with different text.",2026-07-02
r5,5,5,,2026-07-03`
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
    expect(job).toMatchObject({ status: 'completed', usableRows: 2, writtenRows: 1, ratingOnlyRows: 1, duplicateRows: 2, invalidRows: 2, errorMessage: null })
    const reviews = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews`).then((response) => response.json())
    expect(reviews.data.items).toHaveLength(2)
  })

  it('filters the inventory with parameterized server queries', async () => {
    const project = await post('/api/projects', { name: 'Inventory', primaryDecision: 'operations' }).then((response) => response.json())
    await importCsv(project.data.id, `review_id,source,entity,rating,review_text,review_date,language
r1,google_business,Berlin,5,"Wonderful staff and quick service",2026-01-10,en
r2,google_business,Hamburg,2,"Long painful wait",2026-02-15,en
r3,trustpilot,Berlin,4,"Schnelle Hilfe",2026-03-20,de
r4,trustpilot,Hamburg,3,,2026-03-21,de
r5,csv_import,Berlin,1,"Painful billing problem",2025-12-01,en`)

    const filtered = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?provider=google_business&entity=Hamburg&rating_min=2&rating_max=2&date_from=2026-02-01&date_to=2026-02-28&language=en&has_text=true&search=painful`).then((response) => response.json())
    expect(filtered.data.items).toHaveLength(1)
    expect(filtered.data.items[0]).toMatchObject({ externalReviewId: 'r2', provider: 'google_business', entityName: 'Hamburg' })

    const ratingOnly = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/reviews?has_text=false`).then((response) => response.json())
    expect(ratingOnly.data.items).toHaveLength(1)
    expect(ratingOnly.data.items[0].externalReviewId).toBe('r4')
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
s2,trustpilot,Hamburg,3,,2026-04-02,de,also-retained
s3,google_business,Berlin,1,"Slow response",2026-04-03,en,third`)

    const summary = await apiFetch(`${baseUrl}/api/projects/${project.data.id}/review-summary`).then((response) => response.json())
    expect(summary.data).toMatchObject({ total: 3, writtenCount: 2, ratingOnlyCount: 1, providerCount: 2, entityCount: 2 })
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
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-')
  })

  it('creates distinct versions and never changes an old snapshot after new data, attempted actions, or a rerun', async () => {
    const fixture = await readyCurationReportFixture('report-immutability')
    const first = (await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId }).then((response) => response.json())).data
    const frozen = structuredClone(first.snapshot)

    const rejectedAction = await curate(fixture.sessionId, 'edit_theme', { themeId: first.snapshot.themes[0].originThemeIds[0], name: 'Changed later' })
    expect(rejectedAction.response.status).toBe(409)
    expect(rejectedAction.payload).toMatchObject({ error: { code: 'CURATION_SESSION_READY' } })

    await importCsv(fixture.projectId, `review_id,source,entity,rating,review_text,review_date,language
later-1,google_business,Berlin,1,"A newly imported complaint about very slow support",2026-06-01,en`)
    const rerun = await post('/api/analysis-runs', {
      projectId: fixture.projectId,
      configuration: { objective: 'full_voice_map', writtenOnly: true, minTextLength: 3 },
    }).then((response) => response.json())
    await waitForAnalysis(rerun.data.id)

    const oldAfterChanges = await apiFetch(`${baseUrl}/api/reports/${first.id}`).then((response) => response.json())
    expect(oldAfterChanges.data.snapshot).toEqual(frozen)
    const second = (await post('/api/reports', { projectId: fixture.projectId, analysisRunId: fixture.runId }).then((response) => response.json())).data
    expect(second.id).not.toBe(first.id)
    expect(second.version).toBe(2)
    expect(second.snapshot.themes).toEqual(frozen.themes)
    expect(second.snapshot.curation).toEqual(frozen.curation)

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
a2,google_business,Berlin,5,,2026-02-11,en
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
      state: 'no_interpretation', engineVersion: 'deterministic-theme-engine-v1', acceptedThemes: 0,
    })

    const membership = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews`).then((response) => response.json())
    expect(membership.data).toHaveLength(7)
    expect(membership.data.filter((review: { inclusionStatus: string }) => review.inclusionStatus === 'included')).toHaveLength(1)
    expect(membership.data.filter((review: { inclusionStatus: string }) => review.inclusionStatus === 'excluded')).toHaveLength(6)
    expect(completed.counts.byReason).toMatchObject({
      user_excluded: 3,
      outside_date_range: 1,
      rating_only: 1,
      too_short: 1,
    })
    expect(completed.counts.byReason).not.toHaveProperty('included')

    const voiceMapResponse = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/voice-map`)
    expect(voiceMapResponse.status).toBe(200)
    const voiceMap = await voiceMapResponse.json()
    expect(voiceMap.data.artifact).toMatchObject({ validationThreshold: 1, voiceMap: { engineVersion: 'deterministic-theme-engine-v1' } })
    expect(voiceMap.data.themes).toHaveLength(0)
    expect(completed.qualityReport.semanticAnalysis).toMatchObject({
      segmentCount: 1, clusteredSegmentCount: 0, outlierCount: 1, clusterCount: 0,
    })

    const ratingOnly = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}/reviews?inclusion_status=excluded&reason=rating_only`).then((response) => response.json())
    expect(ratingOnly.data).toHaveLength(1)
    expect(ratingOnly.data[0]).toMatchObject({ exclusionReason: 'rating_only', originalText: null })

    const mutation = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ configuration: { entities: ['Hamburg'] } }),
    })
    expect(mutation.status).toBe(404)
    const unchanged = await apiFetch(`${baseUrl}/api/analysis-runs/${created.data.id}`).then((response) => response.json())
    expect(unchanged.data.configuration.entities).toEqual(['Berlin'])
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
  it('creates one run-scoped session and projects edit, pin, exclude, split, approve, reject, and readiness actions', async () => {
    const fixture = await createCurationFixture('curation-actions')
    const first = await createCuration(fixture.runId)
    expect(first.response.status).toBe(201)
    expect(first.session).toMatchObject({ analysisRunId: fixture.runId, status: 'draft', revision: 0 })
    const second = await createCuration(fixture.runId)
    expect(second.response.status).toBe(200)
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
      expect.objectContaining({ name: 'Friendly welcome', status: 'approved' }),
      expect.objectContaining({ name: 'Helpful interaction', status: 'approved' }),
    ]))
    expect(split.payload.data.projection.machineThemes.find((theme: { id: string }) => theme.id === splittable.id)).toMatchObject({
      name: 'A warmer welcome',
      summary: 'Human-authored interpretation.',
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
    const afterReady = await curate(first.session.id, 'edit_theme', { themeId: splittable.id, name: 'Too late' })
    expect(afterReady.response.status).toBe(409)
    expect(afterReady.payload).toMatchObject({ error: { code: 'CURATION_SESSION_READY' } })

    const historyResponse = await apiFetch(`${baseUrl}/api/curation-sessions/${first.session.id}/actions`)
    expect(historyResponse.status).toBe(200)
    const history = await historyResponse.json()
    expect(history.data.map((action: { actionType: string }) => action.actionType)).toEqual([
      'edit_theme', 'pin_evidence', 'exclude_evidence', 'split_theme',
      ...pending.map((_: unknown, index: number) => index === 0 ? 'approve_theme' : 'reject_theme'),
      'mark_ready',
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
      type: 'praise', sentiment: 'positive',
    })
    expect(interpreted.evidence[0].originalText.slice(interpreted.evidence[0].quoteStart, interpreted.evidence[0].quoteEnd))
      .toBe(interpreted.evidence[0].quote)
  })

  it('keeps LLM-discarded boilerplate clusters out of the curation queue', async () => {
    const fixture = await createCurationFixture('curation-publication-gate')
    const sourceTheme = fixture.voiceMap.themes.find((theme: { validation: { status: string } }) => theme.validation.status === 'validated')
    expect(sourceTheme).toBeTruthy()
    const database = await getDatabase()
    await database.query(
      `UPDATE themes SET validation = validation || $2::jsonb WHERE id = $1`,
      [sourceTheme.id, JSON.stringify({ interpretationCandidate: {
        label: 'Irrelevant session context', evaluation: 'mixed', rootCause: null, consequence: null,
        signalTypes: ['pain'], confidence: .98, publicationAction: 'discard',
        publicationReason: 'Repeated session boilerplate joins unrelated product feedback.',
      } })],
    )
    const projection = await apiFetch(`${baseUrl}/api/analysis-runs/${fixture.runId}/curation`).then((response) => response.json())
    expect(projection.data.machineThemes.some((theme: { id: string }) => theme.id === sourceTheme.id)).toBe(false)
    expect(projection.data.readiness.validatedMachineThemes).toBe(projection.data.machineThemes.filter((theme: { validationStatus: string }) => theme.validationStatus === 'validated').length)
  })

  it('admits only publishable, resolved interpretations to an LLM curation queue', async () => {
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
    expect(projection.data.machineThemes.map((theme: { id: string }) => theme.id)).toEqual([publishable.id])
    expect(projection.data.machineThemes[0]).toMatchObject({ name: 'Reliable published interpretation', status: 'pending' })
    expect(projection.data.readiness).toMatchObject({ validatedMachineThemes: 1, pending: 1 })
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
