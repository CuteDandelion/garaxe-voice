// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { schemaSql } from './schema'
import type { Database, DatabaseClient } from './database'
import {
  AuthError,
  authSchemaSql,
  authenticateRequest,
  authenticateVerifiedToken,
  authenticateToken,
  authorizeAnalysisRun,
  authorizeProject,
  authorizeReport,
  bindProjectToOrganization,
  createIdentity,
  createSession,
  createSupabaseClaimsVerifier,
  hashSessionToken,
  parseBearerToken,
  requireOrganizationMembership,
  revokeSession,
  supabaseAuthConfiguration,
} from './auth'

let database: PGlite

async function project(name: string) {
  const id = randomUUID()
  await database.query('INSERT INTO projects (id, name, primary_decision) VALUES ($1,$2,$3)', [id, name, 'research'])
  return id
}

async function run(projectId: string) {
  const id = randomUUID()
  await database.query(
    `INSERT INTO analysis_runs
      (id, project_id, objective, configuration, status, stage, pipeline_version)
     VALUES ($1,$2,'full_voice_map','{}','completed','completed','test-v1')`,
    [id, projectId],
  )
  return id
}

async function report(projectId: string, runId: string) {
  const sessionId = randomUUID()
  const reportId = randomUUID()
  await database.query(
    `INSERT INTO curation_sessions (id, analysis_run_id, status, revision, ready_at)
     VALUES ($1,$2,'ready',1,NOW())`, [sessionId, runId],
  )
  await database.query(
    `INSERT INTO reports
      (id, project_id, analysis_run_id, curation_session_id, curation_revision, version, title, snapshot)
     VALUES ($1,$2,$3,$4,1,1,'Report','{}')`, [reportId, projectId, runId, sessionId],
  )
  return reportId
}

beforeEach(async () => {
  database = new PGlite()
  await database.exec(schemaSql)
  await database.exec(authSchemaSql)
})

describe('opaque sessions', () => {
  it('stores only a one-way token hash and resolves memberships', async () => {
    const identity = await createIdentity(database, {
      email: 'Owner@Example.com', displayName: 'Alex Rivera', organizationName: 'Acme',
    })
    const session = await createSession(database, identity.userId)
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const stored = await database.query<{ tokenHash: string }>(
      'SELECT token_hash AS "tokenHash" FROM auth_sessions WHERE id = $1', [session.sessionId],
    )
    expect(stored.rows[0].tokenHash).toBe(hashSessionToken(session.token))
    expect(stored.rows[0].tokenHash).not.toContain(session.token)

    const context = await authenticateToken(database, session.token)
    expect(context).toMatchObject({
      user: { id: identity.userId, email: 'owner@example.com', displayName: 'Alex Rivera' },
      memberships: [{ organizationId: identity.organizationId, organizationName: 'Acme', role: 'owner' }],
    })
    expect(JSON.stringify(context)).not.toContain(session.token)
  })

  it('parses strict bearer authorization and rejects absent or malformed credentials', async () => {
    const identity = await createIdentity(database, {
      email: 'reader@example.com', displayName: 'Reader', organizationName: 'Reader Org',
    })
    const session = await createSession(database, identity.userId)
    expect(parseBearerToken({ headers: { authorization: `Bearer ${session.token}` } })).toBe(session.token)
    expect(() => parseBearerToken({ headers: { authorization: 'Basic secret' } })).toThrowError(AuthError)
    await expect(authenticateRequest(database, { headers: {} })).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 })
    await expect(authenticateRequest(database, { headers: { authorization: `Bearer ${session.token}` } })).resolves.toMatchObject({
      user: { id: identity.userId },
    })
  })

  it('rejects unknown, expired, and revoked tokens without leaking token material', async () => {
    const identity = await createIdentity(database, {
      email: 'session@example.com', displayName: 'Session User', organizationName: 'Session Org',
    })
    const session = await createSession(database, identity.userId)
    expect(await revokeSession(database, session.sessionId, identity.userId)).toBe(true)
    await expect(authenticateToken(database, session.token)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401, message: 'A valid session is required.',
    })
    await expect(authenticateToken(database, 'nonexistent-token')).rejects.not.toThrow(session.token)
  })
})

describe('Supabase bearer sessions', () => {
  it('requires a complete HTTPS URL and publishable-key server contract', () => {
    expect(supabaseAuthConfiguration({})).toBeNull()
    expect(supabaseAuthConfiguration({
      SUPABASE_URL: 'https://voice-lab-test.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })).toEqual({
      url: 'https://voice-lab-test.supabase.co',
      publishableKey: 'sb_publishable_test',
    })
    expect(supabaseAuthConfiguration({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local',
    })).toEqual({ url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_local' })
    expect(() => supabaseAuthConfiguration({ SUPABASE_URL: 'https://voice-lab-test.supabase.co' })).toThrow(
      'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together.',
    )
    expect(() => supabaseAuthConfiguration({
      SUPABASE_URL: 'http://voice-lab-test.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })).toThrow('SUPABASE_URL must use HTTPS or loopback HTTP.')
  })

  it('maps verified claims to the existing profile and memberships without creating grants', async () => {
    const identity = await createIdentity(database, {
      email: 'member@example.com', displayName: 'Member', organizationName: 'Member Org', role: 'analyst',
    })

    await expect(authenticateVerifiedToken(database, 'header.payload.signature', async () => ({
      sub: identity.userId,
      sessionId: 'supabase-session-1',
      email: ' MEMBER@example.com ',
    }))).resolves.toMatchObject({
      sessionId: 'supabase-session-1',
      user: { id: identity.userId, email: 'member@example.com', displayName: 'Member' },
      memberships: [{ organizationId: identity.organizationId, role: 'analyst' }],
    })

    const memberships = await database.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM organization_memberships WHERE user_id = $1', [identity.userId],
    )
    expect(memberships.rows[0]?.count).toBe('1')
  })

  it('fails closed for invalid claims', async () => {
    await expect(authenticateVerifiedToken(database, 'invalid.jwt.value', async () => {
      throw new Error('provider detail must stay private')
    })).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401, message: 'A valid session is required.' })
  })

  it('provisions one personal workspace on first verified login and reuses it', async () => {
    const userId = randomUUID()
    const verifyClaims = async () => ({
      sub: userId,
      sessionId: 'first-login-session',
      email: ' New.Owner@example.com ',
    })

    const first = await authenticateVerifiedToken(database, 'header.payload.signature', verifyClaims)
    const second = await authenticateVerifiedToken(database, 'header.payload.signature', verifyClaims)

    expect(first).toMatchObject({
      user: { id: userId, email: 'new.owner@example.com' },
      memberships: [{ organizationName: 'Personal workspace', role: 'owner' }],
    })
    expect(second.memberships).toEqual(first.memberships)
    const counts = await database.query<{ users: number; organizations: number; memberships: number; projects: number; bindings: number; projectName: string }>(
      `SELECT
        (SELECT COUNT(*)::int FROM auth_users WHERE id = $1) AS users,
        (SELECT COUNT(*)::int FROM organizations) AS organizations,
        (SELECT COUNT(*)::int FROM organization_memberships WHERE user_id = $1) AS memberships,
        (SELECT COUNT(*)::int FROM projects) AS projects,
        (SELECT COUNT(*)::int FROM project_organizations) AS bindings,
        (SELECT name FROM projects LIMIT 1) AS "projectName"`,
      [userId],
    )
    expect(counts.rows[0]).toEqual({ users: 1, organizations: 1, memberships: 1, projects: 1, bindings: 1, projectName: 'Default project' })
    await expect(authenticateRequest(database, { headers: {} }, verifyClaims)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED', status: 401,
    })
  })

  it('accepts a JWT-shaped bearer token without weakening malformed authorization rejection', () => {
    expect(parseBearerToken({ headers: { authorization: 'Bearer header.payload.signature' } })).toBe('header.payload.signature')
    expect(() => parseBearerToken({ headers: { authorization: 'Bearer header payload signature' } })).toThrowError(AuthError)
  })

  it('authenticates a bearer request through verified Supabase claims when configured', async () => {
    const identity = await createIdentity(database, {
      email: 'verified@example.com', displayName: 'Verified', organizationName: 'Verified Org',
    })
    const verifyClaims = createSupabaseClaimsVerifier(async (token) => ({
      data: { claims: { sub: identity.userId, session_id: 'verified-session', email: 'verified@example.com' } },
      error: token === 'header.payload.signature' ? null : new Error('invalid'),
    }))

    await expect(authenticateRequest(database, {
      headers: { authorization: 'Bearer header.payload.signature' },
    }, verifyClaims)).resolves.toMatchObject({
      sessionId: 'verified-session', user: { id: identity.userId },
    })
  })

  it('sets the verified subject as transaction-local database identity before profile lookup', async () => {
    const userId = randomUUID()
    const clientFor = () => {
      let scopedUser: string | null = null
      const client: DatabaseClient = {
        exec: async () => undefined,
        query: async <Row>(sql: string, parameters: unknown[] = []) => {
          if (sql.includes("set_config('app.current_user_id'")) {
            scopedUser = String(parameters[0])
            return { rows: [] as Row[] }
          }
          if (sql.includes('FROM auth_users')) return { rows: scopedUser === userId
            ? [{ userId, email: 'scoped@example.com', displayName: 'Scoped' } as Row]
            : [] }
          if (sql.includes('FROM organization_memberships')) return { rows: [] as Row[] }
          throw new Error(`Unexpected SQL: ${sql}`)
        },
      }
      return client
    }
    const guardedDatabase: Database = {
      ...clientFor(),
      transaction: async <Result>(work: (client: DatabaseClient) => Promise<Result>) => work(clientFor()),
    }

    await expect(authenticateVerifiedToken(guardedDatabase, 'header.payload.signature', async () => ({
      sub: userId, sessionId: 'scoped-session', email: 'scoped@example.com',
    }))).resolves.toMatchObject({ user: { id: userId }, memberships: [] })
  })
})

describe('tenant authorization', () => {
  it('authorizes project, run, and report ownership through organization membership', async () => {
    const identity = await createIdentity(database, {
      email: 'analyst@example.com', displayName: 'Analyst', organizationName: 'Acme', role: 'analyst',
    })
    const projectId = await project('Acme project')
    await bindProjectToOrganization(database, projectId, identity.organizationId)
    const runId = await run(projectId)
    const reportId = await report(projectId, runId)
    const context = await authenticateToken(database, (await createSession(database, identity.userId)).token)

    await expect(authorizeProject(database, context, projectId)).resolves.toMatchObject({ organizationId: identity.organizationId })
    await expect(authorizeAnalysisRun(database, context, runId)).resolves.toMatchObject({ organizationId: identity.organizationId })
    await expect(authorizeReport(database, context, reportId)).resolves.toMatchObject({ organizationId: identity.organizationId })
    expect(requireOrganizationMembership(context, identity.organizationId, ['analyst', 'admin'])).toMatchObject({ role: 'analyst' })
  })

  it('conceals cross-tenant and insufficient-role resources with the same not-found response', async () => {
    const first = await createIdentity(database, {
      email: 'first@example.com', displayName: 'First', organizationName: 'First Org', role: 'viewer',
    })
    const second = await createIdentity(database, {
      email: 'second@example.com', displayName: 'Second', organizationName: 'Second Org',
    })
    const firstProject = await project('First project')
    const secondProject = await project('Second project')
    await bindProjectToOrganization(database, firstProject, first.organizationId)
    await bindProjectToOrganization(database, secondProject, second.organizationId)
    const context = await authenticateToken(database, (await createSession(database, first.userId)).token)

    await expect(authorizeProject(database, context, secondProject)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    await expect(authorizeProject(database, context, firstProject, ['owner', 'admin'])).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    await expect(authorizeProject(database, context, randomUUID())).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })
})
