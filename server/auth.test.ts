// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { schemaSql } from './schema'
import {
  AuthError,
  authSchemaSql,
  authenticateRequest,
  authenticateToken,
  authorizeAnalysisRun,
  authorizeProject,
  authorizeReport,
  bindProjectToOrganization,
  createIdentity,
  createSession,
  hashSessionToken,
  parseBearerToken,
  requireOrganizationMembership,
  revokeSession,
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
