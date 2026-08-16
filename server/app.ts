import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DemoQuotaTestControl } from './testing/demoQuotaControl'
import { getDatabase, getDemoDatabase } from './db'
import { createImportJob, processImportJob } from './importProcessor'
import { decodeCursor, getReviewDetail, listReviews, summarizeReviews, type ReviewInventoryFilters } from './reviewInventory'
import { getThemeEvidence, getVoiceMapArtifact } from './voiceMapRepository'
import {
  appendCurationAction,
  createCurationSession,
  CurationError,
  getCurationProjection,
  listCurationActions,
} from './curation'
import {
  createAnalysisRun,
  getAnalysisRun,
  listAnalysisRunReviews,
  listAnalysisRuns,
  processAnalysisRun,
  validateAnalysisConfiguration,
} from './analysisRuns'
import type { ColumnMapping } from '../src/lib/csv'
import { CsvValidationError } from '../src/lib/csv'
import { createReportSnapshot, getReport, listReports, ReportError } from './reports'
import { renderReportPdf } from './pdfReports'
import { generateOverviewBrief } from './overviewBrief'
import {
  buildDemoReportSnapshot,
  appendDemoAnalysisSessionCsv,
  createDemoAnalysisSession,
  demoRunUsesOpenCode,
  DemoAnalysisError,
  getDemoAnalysisResult,
  getDemoAnalysisSession,
  getAnalysisCoverage,
  DEMO_MAX_REVIEWS,
  DEMO_COMMENT_ALLOWANCE,
  DEMO_MAX_CURATION_ACTIONS,
  publicDemoCurationProjection,
} from './demoAnalysis'
import {
  contextFromOAuthState,
  DatabaseOAuthStateStore,
  decryptSecret,
  GoogleOAuthClient,
  GoogleOAuthError,
  oauthEnvelopeKeyFromEnv,
} from './googleOAuth'
import { getGoogleConnection, publicGoogleConnection, revokeGoogleConnection, saveGoogleConnection } from './googleConnections'
import { GoogleBusinessConnector, GoogleBusinessConnectorError } from './connectors/googleBusiness'
import { withDatabaseUser } from './database'
import {
  createGoogleSyncImportJob, discoverGoogleEntities, listGoogleEntities, processGoogleSyncImportJob,
  updateSelectedGoogleLocations,
} from './googleSync'
import {
  AuthError,
  authenticateRequest,
  authorizeAnalysisRun,
  authorizeProject,
  authorizeReport,
  bindProjectToOrganization,
  createIdentity,
  createSession,
  configuredSupabaseClaimsVerifier,
  revokeSession,
  type VerifyAuthClaims,
} from './auth'
import { isWaitlistAdmin, listWaitlistSignups } from './waitlistAdmin'
import { AdmissionError, withOrganizationJobAdmission } from './admission'
import { collectLocalPerformanceDiagnostics, sanitizePerformanceDiagnostics } from './performanceDiagnostics'

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(payload))
}

function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `garaxe_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

function stagingAccessConfiguration() {
  if (process.env.NODE_ENV === 'production') return null
  if (process.env.GARAXE_DEPLOYMENT_TIER !== 'staging' || process.env.GARAXE_STAGING_AUTH_ENABLED !== 'true') return null
  const email = process.env.GARAXE_STAGING_OWNER_EMAIL?.trim().toLowerCase()
  const accessKey = process.env.GARAXE_STAGING_ACCESS_KEY || ''
  if (!email || accessKey.length < 32) throw new Error('STAGING_AUTH_MISCONFIGURED')
  return { email, accessKey }
}

function secretMatches(candidate: string, expected: string) {
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateDigest, expectedDigest)
}

export function demoClientKey(request: Pick<IncomingMessage, 'headers' | 'socket'>, environment: NodeJS.ProcessEnv = process.env) {
  const trustedProxy = environment.GARAXE_TRUST_PROXY === 'true'
  const header = (name: string) => {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
  }
  const forwarded = trustedProxy
    ? header('cf-connecting-ip') || header('x-forwarded-for')?.split(',')[0]?.trim()
    : undefined
  const address = forwarded || request.socket.remoteAddress || 'unidentified-client'
  return createHash('sha256').update(address).digest('hex')
}

function googleOAuthClient(database: Awaited<ReturnType<typeof getDatabase>>) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new GoogleOAuthError('OAUTH_NOT_CONFIGURED', 'Google authorization is not configured.')
  return new GoogleOAuthClient({ clientId, clientSecret, envelopeKey: oauthEnvelopeKeyFromEnv(), stateStore: new DatabaseOAuthStateStore(database) })
}

async function readyGoogleConnector(database: Awaited<ReturnType<typeof getDatabase>>, projectId: string, userId: string) {
  const connection = await getGoogleConnection(database, projectId)
  if (!connection || connection.status !== 'connected') throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
  const key = oauthEnvelopeKeyFromEnv()
  let encryptedAccessToken = connection.encryptedAccessToken
  if (connection.accessTokenExpiresAt && new Date(connection.accessTokenExpiresAt).getTime() <= Date.now()) {
    const refreshed = await googleOAuthClient(database).refresh({
      encryptedAccessToken: connection.encryptedAccessToken, encryptedRefreshToken: connection.encryptedRefreshToken,
      accessTokenExpiresAt: new Date(connection.accessTokenExpiresAt), grantedScope: connection.grantedScope,
      status: connection.status, capabilities: connection.capabilities,
    })
    await saveGoogleConnection(database, {
      organizationId: connection.organizationId, projectId: connection.projectId, userId, credentials: refreshed,
    })
    encryptedAccessToken = refreshed.encryptedAccessToken
  }
  return {
    connection,
    connector: new GoogleBusinessConnector({
      getAccessToken: async () => decryptSecret(encryptedAccessToken, key),
      accountManagementBaseUrl: process.env.GOOGLE_ACCOUNT_MANAGEMENT_BASE_URL,
      businessInformationBaseUrl: process.env.GOOGLE_BUSINESS_INFORMATION_BASE_URL,
      reviewsBaseUrl: process.env.GOOGLE_REVIEWS_BASE_URL,
    }),
  }
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  const maxBytes = Number(process.env.GARAXE_MAX_BODY_BYTES || 5 * 1024 * 1024)
  let received = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    received += buffer.length
    if (received > maxBytes) throw new AuthError('PAYLOAD_TOO_LARGE', 'Request body exceeds the configured limit.', 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function inventoryFilters(url: URL): ReviewInventoryFilters {
  const optionalNumber = (name: string) => {
    const raw = url.searchParams.get(name)
    if (raw === null || raw === '') return undefined
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('INVALID_FILTER')
    return value
  }
  const hasTextRaw = url.searchParams.get('has_text')
  if (hasTextRaw !== null && hasTextRaw !== 'true' && hasTextRaw !== 'false') throw new Error('INVALID_FILTER')
  const ratingOnlyRaw = url.searchParams.get('rating_only')
  if (ratingOnlyRaw !== null && ratingOnlyRaw !== 'true' && ratingOnlyRaw !== 'false') throw new Error('INVALID_FILTER')
  if (hasTextRaw !== null && ratingOnlyRaw !== null && (hasTextRaw === 'true') === (ratingOnlyRaw === 'true')) throw new Error('INVALID_FILTER')
  const dateFrom = url.searchParams.get('date_from') || undefined
  const dateTo = url.searchParams.get('date_to') || undefined
  if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) throw new Error('INVALID_FILTER')
  return {
    provider: (url.searchParams.get('provider') || url.searchParams.get('source'))?.trim() || undefined,
    entity: url.searchParams.get('entity')?.trim() || undefined,
    ratingMin: optionalNumber('rating_min'),
    ratingMax: optionalNumber('rating_max'),
    dateFrom,
    dateTo,
    language: url.searchParams.get('language')?.trim() || undefined,
    hasText: hasTextRaw !== null ? hasTextRaw === 'true' : ratingOnlyRaw !== null ? ratingOnlyRaw !== 'true' : undefined,
    search: (url.searchParams.get('search') || url.searchParams.get('q'))?.trim() || undefined,
  }
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: { verifyClaims?: VerifyAuthClaims; demoQuotaControl?: DemoQuotaTestControl; performanceDiagnostics?: () => Promise<unknown> } = {},
) {
  const url = new URL(request.url || '/', 'http://localhost')
  const demoQuotaControl = process.env.NODE_ENV === 'production' ? undefined : dependencies.demoQuotaControl
  const demoNow = () => demoQuotaControl?.now() ?? new Date()

  try {
    if (request.method === 'GET' && url.pathname === '/api/live') {
      return json(response, 200, { status: 'alive' })
    }

    if (request.method === 'POST' && url.pathname === '/api/_test/demo-quota-clock') {
      const suppliedToken = String(request.headers['x-voice-lab-test-control'] || '')
      if (!demoQuotaControl || !secretMatches(suppliedToken, demoQuotaControl.token)) {
        return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      }
      const input = await body(request)
      const advanceMs = Number(input.advanceMs)
      if (!Number.isSafeInteger(advanceMs) || advanceMs < 1 || advanceMs > 24 * 60 * 60 * 1_000) {
        return json(response, 400, { error: { code: 'TEST_CLOCK_INVALID', message: 'Advance must be between one millisecond and 24 hours.' } })
      }
      return json(response, 200, { data: { now: demoQuotaControl.advance(advanceMs).toISOString() } })
    }

    if (request.method === 'GET' && url.pathname === '/api/_test/performance-diagnostics') {
      const address = request.socket.remoteAddress || ''
      const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
      if (process.env.NODE_ENV === 'production' || process.env.GARAXE_LOCAL_PERFORMANCE_DIAGNOSTICS !== 'true' || !loopback) {
        return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      }
      const database = await getDatabase()
      const diagnostics = dependencies.performanceDiagnostics
        ? await dependencies.performanceDiagnostics()
        : await collectLocalPerformanceDiagnostics([
          { database, lane: 'authenticated' },
          { database: await getDemoDatabase(), lane: 'demo' },
        ])
      return json(response, 200, { data: sanitizePerformanceDiagnostics(diagnostics) })
    }

    if (request.method === 'POST' && url.pathname === '/api/demo/analysis-runs') {
      const database = await getDemoDatabase()
      const input = await body(request)
      const now = demoNow()
      const session = await createDemoAnalysisSession(database, { fileName: input.fileName, rawCsv: input.rawCsv, mapping: input.mapping, clientKey: demoClientKey(request) }, process.env, now)
      setImmediate(() => void processAnalysisRun(database, session.analysisRunId))
      const status = await getDemoAnalysisSession(database, session.token, now)
      return json(response, 202, { data: {
        token: session.token, status: 'queued', stage: 'queued', demo: true,
        createdAt: session.createdAt, expiresAt: session.expiresAt, retentionHours: 24,
        maxRecords: DEMO_MAX_REVIEWS, allowance: DEMO_COMMENT_ALLOWANCE, addedRecords: session.addedRecords,
        duplicateRecords: session.duplicateRecords, notImportedRecords: session.notImportedRecords, quota: status?.quota,
      } })
    }

    const demoImportMatch = url.pathname.match(/^\/api\/demo\/analysis-runs\/([A-Za-z0-9_-]{43})\/imports$/)
    if (request.method === 'POST' && demoImportMatch) {
      const database = await getDemoDatabase()
      const input = await body(request)
      const result = await appendDemoAnalysisSessionCsv(database, demoImportMatch[1], input, process.env, demoNow())
      if (result.addedRecords > 0) setImmediate(() => void processAnalysisRun(database, result.analysisRunId))
      return json(response, result.addedRecords > 0 ? 202 : 200, { data: {
        token: demoImportMatch[1], status: result.addedRecords > 0 ? 'queued' : 'completed',
        stage: result.addedRecords > 0 ? 'queued' : 'completed', demo: true,
        addedRecords: result.addedRecords, duplicateRecords: result.duplicateRecords,
        notImportedRecords: result.notImportedRecords, expiresAt: result.expiresAt, quota: result.quota,
      } })
    }

    const demoRunMatch = url.pathname.match(/^\/api\/demo\/analysis-runs\/([A-Za-z0-9_-]{43})$/)
    if (request.method === 'GET' && demoRunMatch) {
      const database = await getDemoDatabase()
      const session = await getDemoAnalysisSession(database, demoRunMatch[1], demoNow())
      if (!session) return json(response, 404, { error: { code: 'DEMO_SESSION_NOT_FOUND', message: 'The demo session was not found or has expired.' } })
      if (session.status === 'failed') return json(response, 200, { data: {
        status: 'failed', stage: 'failed', demo: true, expiresAt: session.expiresAt,
        quota: session.quota,
        message: 'The live demo analysis did not complete. No persistent report was created.',
      } })
      if (session.status === 'completed') {
        if (!demoRunUsesOpenCode(session)) return json(response, 200, { data: {
          status: 'failed', stage: 'failed', demo: true, expiresAt: session.expiresAt,
          quota: session.quota,
          message: 'The analysis engine did not complete interpretation. No demo report is available.',
        } })
        const result = await getDemoAnalysisResult(database, session)
        if (!result) throw new DemoAnalysisError('DEMO_RESULT_NOT_READY', 'The demo result is not ready.', 409)
        return json(response, 200, { data: {
          status: 'completed', stage: 'completed', demo: true, expiresAt: session.expiresAt,
          quota: session.quota,
          engine: result.engine, themes: result.themes, coverage: result.coverage,
          pdfUrl: `/api/demo/analysis-runs/${demoRunMatch[1]}/pdf`,
        } })
      }
      return json(response, 200, { data: {
        status: session.status, stage: session.stage, demo: true, expiresAt: session.expiresAt,
        quota: session.quota,
      } })
    }

    const demoPdfMatch = url.pathname.match(/^\/api\/demo\/analysis-runs\/([A-Za-z0-9_-]{43})\/pdf$/)
    if (request.method === 'GET' && demoPdfMatch) {
      const database = await getDemoDatabase()
      const session = await getDemoAnalysisSession(database, demoPdfMatch[1])
      if (!session) return json(response, 404, { error: { code: 'DEMO_SESSION_NOT_FOUND', message: 'The demo session was not found or has expired.' } })
      const pdf = await renderReportPdf(await buildDemoReportSnapshot(database, session))
      response.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="voice-map-demo-report.pdf"',
        'content-length': String(pdf.length),
        'cache-control': 'private, no-store, max-age=0',
        expires: '0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      response.end(pdf)
      return
    }

    const demoOverviewMatch = url.pathname.match(/^\/api\/demo\/analysis-runs\/([A-Za-z0-9_-]{43})\/overview$/)
    if (request.method === 'GET' && demoOverviewMatch) {
      const database = await getDemoDatabase()
      const session = await getDemoAnalysisSession(database, demoOverviewMatch[1])
      if (!session) return json(response, 404, { error: { code: 'DEMO_SESSION_NOT_FOUND', message: 'The demo session was not found or has expired.' } })
      if (session.status !== 'completed' || !demoRunUsesOpenCode(session)) throw new DemoAnalysisError('DEMO_RESULT_NOT_READY', 'The demo result is not ready.', 409)
      const projection = await getCurationProjection(database, session.analysisRunId)
      return json(response, 200, { data: await generateOverviewBrief(projection.effectiveThemes) })
    }

    const demoCurationMatch = url.pathname.match(/^\/api\/demo\/analysis-runs\/([A-Za-z0-9_-]{43})\/curation$/)
    if (demoCurationMatch && (request.method === 'GET' || request.method === 'POST')) {
      const database = await getDemoDatabase()
      const session = await getDemoAnalysisSession(database, demoCurationMatch[1])
      if (!session) return json(response, 404, { error: { code: 'DEMO_SESSION_NOT_FOUND', message: 'The demo session was not found or has expired.' } })
      if (session.status !== 'completed' || !demoRunUsesOpenCode(session)) throw new DemoAnalysisError('DEMO_RESULT_NOT_READY', 'The demo result is not ready.', 409)
      const { session: curation } = await createCurationSession(database, session.analysisRunId)
      if (request.method === 'GET') return json(response, 200, { data: publicDemoCurationProjection(await getCurationProjection(database, session.analysisRunId)) })
      const actionCount = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM curation_actions WHERE curation_session_id = $1', [curation.id])
      if ((actionCount.rows[0]?.count || 0) >= DEMO_MAX_CURATION_ACTIONS) throw new DemoAnalysisError('DEMO_CURATION_LIMIT_REACHED', 'This temporary demo has reached its curation change limit.', 429)
      const input = await body(request)
      const result = await appendCurationAction(database, curation.id, { actionType: input.actionType, payload: input.payload }, `demo:${session.id}`)
      return json(response, 201, { data: { ...result, projection: publicDemoCurationProjection(result.projection) } })
    }

    let database = await getDatabase()
    const supabaseClaimsVerifier = dependencies.verifyClaims || configuredSupabaseClaimsVerifier()
    const mutating = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
    const cookieAuthenticated = request.headers.cookie?.includes('garaxe_session=')
    const allowedOrigin = process.env.GARAXE_ALLOWED_ORIGIN
    if (mutating && cookieAuthenticated && allowedOrigin && request.headers.origin !== allowedOrigin) {
      throw new AuthError('ORIGIN_FORBIDDEN', 'Request origin is not allowed.', 403)
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      await database.query('SELECT 1')
      return json(response, 200, { status: 'ready', database: process.env.DATABASE_URL ? 'postgres' : 'pglite' })
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/status') {
      const users = await database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM auth_users')
      return json(response, 200, { data: {
        needsBootstrap: !supabaseClaimsVerifier && process.env.GARAXE_ADMIN_BOOTSTRAP_ENABLED === 'true' && Number(users.rows[0]?.count || 0) === 0,
        stagingAccessEnabled: !supabaseClaimsVerifier && Boolean(stagingAccessConfiguration()),
      } })
    }

    if (request.method === 'POST' && url.pathname === '/api/waitlist') {
      const input = await body(request)
      const name = String(input.name || '').trim().replace(/\s+/g, ' ')
      const email = String(input.email || '').trim().toLowerCase()
      const consentVersion = String(input.consentVersion || '')
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      if (!name || name.length > 120 || email.length > 254 || !emailValid || consentVersion !== 'voice-lab-waitlist-v1') {
        return json(response, 400, { error: { code: 'WAITLIST_SUBMISSION_INVALID', message: 'Enter a valid name, email, and consent.' } })
      }
      await database.query(
        `INSERT INTO waitlist_signups (id, name, email_normalized, consent_version)
         VALUES ($1, $2, $3, $4) ON CONFLICT (email_normalized) DO NOTHING`,
        [randomUUID(), name, email, consentVersion],
      )
      return json(response, 200, { data: { status: 'recorded' } })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap') {
      if (supabaseClaimsVerifier) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      if (process.env.GARAXE_ADMIN_BOOTSTRAP_ENABLED !== 'true') return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const users = await database.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM auth_users')
      if (Number(users.rows[0]?.count || 0) !== 0) {
        return json(response, 409, { error: { code: 'BOOTSTRAP_CLOSED', message: 'Initial owner setup is already complete.' } })
      }
      const input = await body(request)
      const identity = await createIdentity(database, {
        email: String(input.email || ''),
        displayName: String(input.displayName || ''),
        organizationName: String(input.organizationName || ''),
      })
      await database.query(
        `INSERT INTO project_organizations (project_id, organization_id)
         SELECT p.id, $1 FROM projects p
         WHERE NOT EXISTS (SELECT 1 FROM project_organizations po WHERE po.project_id = p.id)`,
        [identity.organizationId],
      )
      const session = await createSession(database, identity.userId)
      response.setHeader('set-cookie', sessionCookie(session.token, 60 * 60 * 24 * 30))
      return json(response, 201, { data: { userId: identity.userId, organizationId: identity.organizationId, token: session.token, expiresAt: session.expiresAt } })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/local-session') {
      if (supabaseClaimsVerifier) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const address = request.socket.remoteAddress || ''
      const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
      if (process.env.NODE_ENV === 'production' || !loopback) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const input = await body(request)
      const email = String(input.email || '').trim().toLowerCase()
      const user = await database.query<{ id: string }>('SELECT id FROM auth_users WHERE email = $1', [email])
      if (!user.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      const session = await createSession(database, user.rows[0].id)
      response.setHeader('set-cookie', sessionCookie(session.token, 60 * 60 * 24 * 30))
      return json(response, 201, { data: { expiresAt: session.expiresAt } })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/staging-session') {
      if (supabaseClaimsVerifier) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const configuration = stagingAccessConfiguration()
      if (!configuration) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const input = await body(request)
      const email = String(input.email || '').trim().toLowerCase()
      const accessKey = String(input.accessKey || '')
      if (email !== configuration.email || !secretMatches(accessKey, configuration.accessKey)) {
        throw new AuthError('AUTHENTICATION_FAILED', 'Authentication failed.', 401)
      }
      const user = await database.query<{ id: string }>('SELECT id FROM auth_users WHERE email = $1', [email])
      if (!user.rows[0]) throw new AuthError('AUTHENTICATION_FAILED', 'Authentication failed.', 401)
      const session = await createSession(database, user.rows[0].id)
      response.setHeader('set-cookie', sessionCookie(session.token, 60 * 60 * 24 * 30))
      return json(response, 201, { data: { expiresAt: session.expiresAt } })
    }

    const auth = await authenticateRequest(database, request, supabaseClaimsVerifier)
    database = withDatabaseUser(database, auth.user.id)

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      return json(response, 200, { data: {
        sessionId: auth.sessionId,
        user: auth.user,
        memberships: auth.memberships,
        capabilities: { waitlistMonitoring: isWaitlistAdmin(auth) },
      } })
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/waitlist') {
      const limit = Number(url.searchParams.get('limit') || 25)
      const offset = Number(url.searchParams.get('offset') || 0)
      return json(response, 200, { data: await listWaitlistSignups(database, auth, process.env, { limit, offset }) })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      await revokeSession(database, auth.sessionId, auth.user.id)
      response.setHeader('set-cookie', sessionCookie('', 0))
      return json(response, 200, { data: { signedOut: true } })
    }

    if (request.method === 'POST' && url.pathname === '/api/connections/google/start') {
      const input = await body(request)
      const projectId = String(input.projectId || '')
      const ownership = await authorizeProject(database, auth, projectId, ['owner', 'admin'])
      const redirectUri = process.env.GOOGLE_REDIRECT_URI
      if (!redirectUri) throw new GoogleOAuthError('OAUTH_NOT_CONFIGURED', 'Google authorization is not configured.')
      const result = await googleOAuthClient(database).beginAuthorization({
        organizationId: ownership.organizationId, userId: auth.user.id, projectId, redirectUri,
      })
      return json(response, 200, { data: result })
    }

    if (request.method === 'GET' && url.pathname === '/api/connections/google/callback') {
      const state = url.searchParams.get('state') || ''
      const code = url.searchParams.get('code') || ''
      if (!state || !code) throw new GoogleOAuthError('OAUTH_CALLBACK_INVALID', 'Google authorization did not return the required values.')
      const connectionContext = contextFromOAuthState(state)
      if (!connectionContext.projectId) throw new GoogleOAuthError('OAUTH_STATE_INVALID', 'Authorization expired or is no longer valid.')
      const ownership = await authorizeProject(database, auth, connectionContext.projectId, ['owner', 'admin'])
      if (ownership.organizationId !== connectionContext.organizationId) throw new GoogleOAuthError('OAUTH_STATE_INVALID', 'Authorization expired or is no longer valid.')
      const credentials = await googleOAuthClient(database).exchangeAuthorizationCode({ state, code, userId: auth.user.id })
      const connectionId = await saveGoogleConnection(database, {
        organizationId: ownership.organizationId, projectId: connectionContext.projectId, userId: auth.user.id, credentials,
      })
      response.writeHead(302, {
        location: `/?google=connected&project=${encodeURIComponent(connectionContext.projectId)}`,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      })
      response.end()
      return
    }

    const googleConnectionMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/connections\/google$/)
    if (request.method === 'GET' && googleConnectionMatch) {
      await authorizeProject(database, auth, googleConnectionMatch[1])
      return json(response, 200, { data: publicGoogleConnection(await getGoogleConnection(database, googleConnectionMatch[1])) })
    }

    if (request.method === 'DELETE' && googleConnectionMatch) {
      await authorizeProject(database, auth, googleConnectionMatch[1], ['owner', 'admin'])
      const connection = await getGoogleConnection(database, googleConnectionMatch[1])
      if (!connection) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await googleOAuthClient(database).disconnect({
        encryptedAccessToken: connection.encryptedAccessToken,
        encryptedRefreshToken: connection.encryptedRefreshToken,
        accessTokenExpiresAt: connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt) : null,
        grantedScope: connection.grantedScope,
        status: connection.status,
        capabilities: connection.capabilities,
      })
      await revokeGoogleConnection(database, connection.id)
      return json(response, 200, { data: { status: 'revoked' } })
    }

    const googleProbeMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/connections\/google\/probe$/)
    if (request.method === 'POST' && googleProbeMatch) {
      await authorizeProject(database, auth, googleProbeMatch[1], ['owner', 'admin', 'analyst'])
      const { connector } = await readyGoogleConnector(database, googleProbeMatch[1], auth.user.id)
      return json(response, 200, { data: await connector.probeAccess() })
    }

    const googleEntitiesMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/connections\/google\/entities$/)
    if (request.method === 'GET' && googleEntitiesMatch) {
      await authorizeProject(database, auth, googleEntitiesMatch[1])
      const connection = await getGoogleConnection(database, googleEntitiesMatch[1])
      if (!connection) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      return json(response, 200, { data: await listGoogleEntities(database, connection.id) })
    }
    if (request.method === 'POST' && googleEntitiesMatch) {
      await authorizeProject(database, auth, googleEntitiesMatch[1], ['owner', 'admin', 'analyst'])
      const { connection, connector } = await readyGoogleConnector(database, googleEntitiesMatch[1], auth.user.id)
      return json(response, 200, { data: await discoverGoogleEntities(database, connection.id, connector) })
    }
    if (request.method === 'PUT' && googleEntitiesMatch) {
      await authorizeProject(database, auth, googleEntitiesMatch[1], ['owner', 'admin', 'analyst'])
      const connection = await getGoogleConnection(database, googleEntitiesMatch[1])
      if (!connection) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      const input = await body(request)
      if (!Array.isArray(input.entityExternalIds) || input.entityExternalIds.some((value) => typeof value !== 'string')) {
        return json(response, 400, { error: { code: 'GOOGLE_LOCATION_SELECTION_INVALID', message: 'Choose valid Google Business locations.' } })
      }
      return json(response, 200, { data: await updateSelectedGoogleLocations(database, connection.id, input.entityExternalIds as string[]) })
    }

    const googleSyncMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/connections\/google\/sync$/)
    if (request.method === 'POST' && googleSyncMatch) {
      await authorizeProject(database, auth, googleSyncMatch[1], ['owner', 'admin', 'analyst'])
      const { connection, connector } = await readyGoogleConnector(database, googleSyncMatch[1], auth.user.id)
      const job = await createGoogleSyncImportJob(database, { projectId: googleSyncMatch[1], connectionId: connection.id })
      setImmediate(() => void processGoogleSyncImportJob(database, job.jobId, connector).catch((error) => {
        console.error('Google sync job failed.', { jobId: job.jobId, error: error instanceof Error ? error.name : 'UnknownError' })
      }))
      return json(response, 202, { data: { id: job.jobId, status: 'queued', selectedLocationCount: job.selectedLocationCount } })
    }

    if (request.method === 'POST' && url.pathname === '/api/projects') {
      const input = await body(request)
      const name = String(input.name || '').trim()
      const primaryDecision = String(input.primaryDecision || 'explore').trim()
      if (!name) return json(response, 400, { error: { code: 'PROJECT_NAME_REQUIRED', message: 'Project name is required.' } })
      const id = randomUUID()
      const organizationId = String(input.organizationId || auth.memberships[0]?.organizationId || '')
      const membership = auth.memberships.find((item) => item.organizationId === organizationId)
      if (!membership || !['owner', 'admin', 'analyst'].includes(membership.role)) {
        throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      }
      await database.query(
        `INSERT INTO projects (id, name, primary_decision) VALUES ($1, $2, $3)`,
        [id, name, primaryDecision],
      )
      await bindProjectToOrganization(database, id, organizationId)
      return json(response, 201, { data: { id, name, primaryDecision } })
    }

    if (request.method === 'GET' && url.pathname === '/api/projects') {
      const result = await database.query(
        `SELECT p.id, p.name, p.primary_decision AS "primaryDecision", p.created_at AS "createdAt"
         FROM projects p JOIN project_organizations po ON po.project_id = p.id
         JOIN organization_memberships m ON m.organization_id = po.organization_id
         WHERE m.user_id = $1 ORDER BY p.created_at DESC`, [auth.user.id],
      )
      return json(response, 200, { data: result.rows })
    }

    if (request.method === 'POST' && url.pathname === '/api/reports') {
      const input = await body(request)
      await authorizeProject(database, auth, String(input.projectId || ''), ['owner', 'admin', 'analyst'])
      await authorizeAnalysisRun(database, auth, String(input.analysisRunId || ''), ['owner', 'admin', 'analyst'])
      const report = await createReportSnapshot(database, input)
      return json(response, 201, { data: report })
    }

    const projectReportsMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/reports$/)
    if (request.method === 'GET' && projectReportsMatch) {
      await authorizeProject(database, auth, projectReportsMatch[1])
      return json(response, 200, { data: await listReports(database, projectReportsMatch[1]) })
    }

    const reportMatch = url.pathname.match(/^\/api\/reports\/([0-9a-f-]+)$/)
    if (request.method === 'GET' && reportMatch) {
      await authorizeReport(database, auth, reportMatch[1])
      const report = await getReport(database, reportMatch[1])
      if (!report) return json(response, 404, { error: { code: 'REPORT_NOT_FOUND', message: 'Report not found.' } })
      return json(response, 200, { data: report })
    }

    const reportPdfMatch = url.pathname.match(/^\/api\/reports\/([0-9a-f-]+)\/pdf$/)
    if (request.method === 'GET' && reportPdfMatch) {
      await authorizeReport(database, auth, reportPdfMatch[1])
      const report = await getReport(database, reportPdfMatch[1]) as { title?: string; snapshot?: Record<string, unknown> } | null
      if (!report?.snapshot) return json(response, 404, { error: { code: 'REPORT_NOT_FOUND', message: 'Report not found.' } })
      const pdf = await renderReportPdf(report.snapshot)
      const safeTitle = String(report.title || 'voice-map').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'voice-map'
      response.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${safeTitle}.pdf"`,
        'content-length': String(pdf.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(pdf)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/analysis-runs') {
      const input = await body(request)
      const projectId = String(input.projectId || '')
      if (!projectId) return json(response, 400, { error: { code: 'ANALYSIS_REQUEST_INVALID', message: 'Project is required.' } })
      const authorization = await authorizeProject(database, auth, projectId, ['owner', 'admin', 'analyst'])
      const configuration = validateAnalysisConfiguration(input.configuration)
      const run = await withOrganizationJobAdmission(database, authorization.organizationId, async (transaction) => {
        const active = await transaction.query(
          `SELECT 1 FROM analysis_runs WHERE project_id = $1
           AND status IN ('queued','assembling_dataset','preprocessing','interpreting_clusters') LIMIT 1`,
          [projectId],
        )
        if (active.rows.length) throw new AdmissionError('PROJECT_ANALYSIS_ACTIVE', 'Wait for the current project analysis to finish before starting another.', 409)
        return createAnalysisRun(transaction, projectId, configuration)
      })
      setImmediate(() => void processAnalysisRun(database, run.id))
      return json(response, 202, { data: run })
    }

    const projectAnalysisRunsMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/analysis-runs$/)
    if (request.method === 'GET' && projectAnalysisRunsMatch) {
      await authorizeProject(database, auth, projectAnalysisRunsMatch[1])
      return json(response, 200, { data: await listAnalysisRuns(database, projectAnalysisRunsMatch[1]) })
    }

    const analysisRunReviewsMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/reviews$/)
    if (request.method === 'GET' && analysisRunReviewsMatch) {
      await authorizeAnalysisRun(database, auth, analysisRunReviewsMatch[1])
      const run = await getAnalysisRun(database, analysisRunReviewsMatch[1])
      if (!run) return json(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run not found.' } })
      const inclusionStatus = url.searchParams.get('inclusion_status') || undefined
      if (inclusionStatus && inclusionStatus !== 'included' && inclusionStatus !== 'excluded') {
        return json(response, 400, { error: { code: 'ANALYSIS_QUERY_INVALID', message: 'Inclusion status must be included or excluded.' } })
      }
      const limit = Number(url.searchParams.get('limit') || 200)
      if (!Number.isInteger(limit) || limit < 1) return json(response, 400, { error: { code: 'ANALYSIS_QUERY_INVALID', message: 'Limit must be a positive integer.' } })
      const reviews = await listAnalysisRunReviews(
        database,
        analysisRunReviewsMatch[1],
        inclusionStatus,
        url.searchParams.get('reason') || undefined,
        Math.min(limit, 500),
      )
      return json(response, 200, { data: reviews })
    }

    const analysisRunCoverageMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/coverage$/)
    if (request.method === 'GET' && analysisRunCoverageMatch) {
      await authorizeAnalysisRun(database, auth, analysisRunCoverageMatch[1])
      return json(response, 200, { data: await getAnalysisCoverage(database, analysisRunCoverageMatch[1]) })
    }

    const analysisVoiceMapMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/voice-map$/)
    if (request.method === 'GET' && analysisVoiceMapMatch) {
      await authorizeAnalysisRun(database, auth, analysisVoiceMapMatch[1])
      const run = await getAnalysisRun(database, analysisVoiceMapMatch[1])
      if (!run) return json(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run not found.' } })
      const artifact = await getVoiceMapArtifact(database, analysisVoiceMapMatch[1])
      if (!artifact) return json(response, 409, { error: { code: 'VOICE_MAP_NOT_READY', message: 'Voice Map is not ready for this run.' } })
      return json(response, 200, { data: { run, ...artifact } })
    }

    const analysisOverviewMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/overview$/)
    if (request.method === 'GET' && analysisOverviewMatch) {
      await authorizeAnalysisRun(database, auth, analysisOverviewMatch[1])
      const run = await getAnalysisRun(database, analysisOverviewMatch[1])
      if (!run) return json(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run not found.' } })
      if (run.status !== 'completed') return json(response, 409, { error: { code: 'OVERVIEW_NOT_READY', message: 'Analysis must complete before the Overview is available.' } })
      const projection = await getCurationProjection(database, analysisOverviewMatch[1])
      return json(response, 200, { data: await generateOverviewBrief(projection.effectiveThemes) })
    }

    const analysisCurationSessionsMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/curation-sessions$/)
    if (request.method === 'POST' && analysisCurationSessionsMatch) {
      await authorizeAnalysisRun(database, auth, analysisCurationSessionsMatch[1], ['owner', 'admin', 'analyst'])
      const result = await createCurationSession(database, analysisCurationSessionsMatch[1])
      return json(response, result.created ? 201 : 200, { data: result })
    }

    const analysisCurationMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)\/curation$/)
    if (request.method === 'GET' && analysisCurationMatch) {
      await authorizeAnalysisRun(database, auth, analysisCurationMatch[1])
      const run = await getAnalysisRun(database, analysisCurationMatch[1])
      if (!run) return json(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run not found.' } })
      return json(response, 200, { data: await getCurationProjection(database, analysisCurationMatch[1]) })
    }

    const curationActionsMatch = url.pathname.match(/^\/api\/curation-sessions\/([0-9a-f-]+)\/actions$/)
    if (request.method === 'GET' && curationActionsMatch) {
      const curationRun = await database.query<{ analysisRunId: string }>(
        'SELECT analysis_run_id AS "analysisRunId" FROM curation_sessions WHERE id = $1', [curationActionsMatch[1]],
      )
      if (!curationRun.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await authorizeAnalysisRun(database, auth, curationRun.rows[0].analysisRunId)
      const actions = await listCurationActions(database, curationActionsMatch[1])
      if (actions.length === 0) {
        const session = await database.query(`SELECT id FROM curation_sessions WHERE id = $1`, [curationActionsMatch[1]])
        if (session.rows.length === 0) return json(response, 404, { error: { code: 'CURATION_SESSION_NOT_FOUND', message: 'Curation session not found.' } })
      }
      return json(response, 200, { data: actions })
    }
    if (request.method === 'POST' && curationActionsMatch) {
      const curationRun = await database.query<{ analysisRunId: string }>(
        'SELECT analysis_run_id AS "analysisRunId" FROM curation_sessions WHERE id = $1', [curationActionsMatch[1]],
      )
      if (!curationRun.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await authorizeAnalysisRun(database, auth, curationRun.rows[0].analysisRunId, ['owner', 'admin', 'analyst'])
      const input = await body(request)
      const result = await appendCurationAction(database, curationActionsMatch[1], {
        actionType: input.actionType,
        payload: input.payload,
      }, auth.user.id)
      return json(response, 201, { data: result })
    }

    const themeEvidenceMatch = url.pathname.match(/^\/api\/themes\/(.+)\/evidence$/)
    if (request.method === 'GET' && themeEvidenceMatch) {
      const themeId = decodeURIComponent(themeEvidenceMatch[1])
      const themeRun = await database.query<{ analysisRunId: string }>('SELECT analysis_run_id AS "analysisRunId" FROM themes WHERE id = $1', [themeId])
      if (!themeRun.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await authorizeAnalysisRun(database, auth, themeRun.rows[0].analysisRunId)
      const evidence = await getThemeEvidence(database, themeId)
      if (evidence.length === 0) return json(response, 404, { error: { code: 'THEME_NOT_FOUND', message: 'Theme or evidence not found.' } })
      return json(response, 200, { data: evidence })
    }

    const analysisRunMatch = url.pathname.match(/^\/api\/analysis-runs\/([0-9a-f-]+)$/)
    if (request.method === 'GET' && analysisRunMatch) {
      await authorizeAnalysisRun(database, auth, analysisRunMatch[1])
      const run = await getAnalysisRun(database, analysisRunMatch[1])
      if (!run) return json(response, 404, { error: { code: 'ANALYSIS_RUN_NOT_FOUND', message: 'Analysis run not found.' } })
      return json(response, 200, { data: run })
    }

    if (request.method === 'POST' && url.pathname === '/api/imports') {
      const input = await body(request)
      const projectId = String(input.projectId || '')
      const fileName = String(input.fileName || '')
      const rawCsv = String(input.rawCsv || '')
      const mapping = input.mapping as ColumnMapping | undefined
      const originalSource = input.originalSource as { encoding?: unknown; content?: unknown; mediaType?: unknown } | undefined
      if (!projectId || !fileName || !rawCsv || !mapping || (originalSource && (!['utf8', 'base64'].includes(String(originalSource.encoding)) || typeof originalSource.content !== 'string' || typeof originalSource.mediaType !== 'string'))) {
        return json(response, 400, { error: { code: 'IMPORT_REQUEST_INVALID', message: 'Project, file, CSV data, and mapping are required.' } })
      }
      const authorization = await authorizeProject(database, auth, projectId, ['owner', 'admin', 'analyst'])

      const importRequest = {
        projectId, fileName, rawCsv, mapping,
        allowLoopbackHttp: process.env.NODE_ENV !== 'production' && process.env.GARAXE_ALLOW_LOCAL_HTTP_SOURCE_URLS === 'true',
        originalSource: originalSource
          ? originalSource as { encoding: 'utf8' | 'base64'; content: string; mediaType: string }
          : { encoding: 'utf8' as const, content: rawCsv, mediaType: 'text/csv' },
      }
      const { jobId, rows } = await withOrganizationJobAdmission(database, authorization.organizationId,
        (transaction) => createImportJob(transaction, importRequest))
      setImmediate(() => void processImportJob(database, jobId, importRequest, rows).catch((error) => {
        console.error('Import job failed.', { jobId, error: error instanceof Error ? error.name : 'UnknownError' })
      }))
      return json(response, 202, { data: { id: jobId, status: 'queued', totalRows: rows.length } })
    }

    const importMatch = url.pathname.match(/^\/api\/imports\/([0-9a-f-]+)$/)
    if (request.method === 'GET' && importMatch) {
      const importProject = await database.query<{ projectId: string }>('SELECT project_id AS "projectId" FROM import_jobs WHERE id = $1', [importMatch[1]])
      if (!importProject.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await authorizeProject(database, auth, importProject.rows[0].projectId)
      const result = await database.query(
        `SELECT id, project_id AS "projectId", file_name AS "fileName", status,
          total_rows AS "totalRows", processed_rows AS "processedRows", usable_rows AS "usableRows",
          written_rows AS "writtenRows", rating_only_rows AS "ratingOnlyRows",
          duplicate_rows AS "duplicateRows", invalid_rows AS "invalidRows", error_message AS "errorMessage"
         FROM import_jobs WHERE id = $1`,
        [importMatch[1]],
      )
      if (result.rows.length === 0) return json(response, 404, { error: { code: 'IMPORT_NOT_FOUND', message: 'Import job not found.' } })
      return json(response, 200, { data: result.rows[0] })
    }

    const reviewSummaryMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/review-summary$/)
    if (request.method === 'GET' && reviewSummaryMatch) {
      await authorizeProject(database, auth, reviewSummaryMatch[1])
      const filters = inventoryFilters(url)
      const result = await summarizeReviews(database, reviewSummaryMatch[1], filters)
      return json(response, 200, { data: result })
    }

    const reviewDetailMatch = url.pathname.match(/^\/api\/reviews\/([0-9a-f-]+)$/)
    if (request.method === 'GET' && reviewDetailMatch) {
      const reviewProject = await database.query<{ projectId: string }>('SELECT project_id AS "projectId" FROM reviews WHERE id = $1', [reviewDetailMatch[1]])
      if (!reviewProject.rows[0]) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
      await authorizeProject(database, auth, reviewProject.rows[0].projectId)
      const result = await getReviewDetail(database, reviewDetailMatch[1])
      if (!result) return json(response, 404, { error: { code: 'REVIEW_NOT_FOUND', message: 'Review not found.' } })
      return json(response, 200, { data: result })
    }

    const reviewsMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/reviews$/)
    if (request.method === 'GET' && reviewsMatch) {
      await authorizeProject(database, auth, reviewsMatch[1])
      const requestedLimit = Number(url.searchParams.get('limit') || 50)
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
        return json(response, 400, { error: { code: 'REVIEW_QUERY_INVALID', message: 'Limit must be a positive integer.' } })
      }
      const filters = inventoryFilters(url)
      if (filters.ratingMin !== undefined && filters.ratingMax !== undefined && filters.ratingMin > filters.ratingMax) {
        return json(response, 400, { error: { code: 'REVIEW_QUERY_INVALID', message: 'Minimum rating cannot exceed maximum rating.' } })
      }
      const cursorValue = url.searchParams.get('cursor')
      const result = await listReviews(database, reviewsMatch[1], filters, Math.min(requestedLimit, 200), cursorValue ? decodeCursor(cursorValue) : undefined)
      return json(response, 200, { data: result })
    }

    return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } })
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      const status = error.code === 'OAUTH_NOT_CONFIGURED' ? 503 : error.code === 'OAUTH_STATE_INVALID' ? 400 : 502
      return json(response, status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof GoogleBusinessConnectorError) {
      return json(response, error.status === 429 ? 429 : error.status === 401 ? 401 : error.status === 403 ? 403 : 502, {
        error: { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds },
      })
    }
    if (error instanceof AuthError) {
      return json(response, error.status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof AdmissionError) {
      return json(response, error.status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof ReportError) {
      return json(response, error.status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof DemoAnalysisError) {
      return json(response, error.status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof CurationError) {
      return json(response, error.status, { error: { code: error.code, message: error.message } })
    }
    if (error instanceof CsvValidationError) {
      return json(response, 400, { error: { code: 'IMPORT_CONTENT_INVALID', message: error.message } })
    }
    if (error instanceof SyntaxError) {
      return json(response, 400, { error: { code: 'REQUEST_BODY_INVALID', message: 'The request body must be valid JSON.' } })
    }
    if (error instanceof Error && (error.message === 'INVALID_CURSOR' || error.message === 'INVALID_FILTER')) {
      return json(response, 400, { error: { code: 'REVIEW_QUERY_INVALID', message: 'Review query parameters are invalid.' } })
    }
    if (error instanceof Error && error.message.startsWith('INVALID_')) {
      return json(response, 400, { error: { code: 'ANALYSIS_CONFIGURATION_INVALID', message: 'Analysis configuration is invalid.', details: { reason: error.message } } })
    }
    console.error('Unhandled API error.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      ...(process.env.NODE_ENV === 'production' || !(error instanceof Error) ? {} : { message: error.message }),
    })
    return json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } })
  }
}
