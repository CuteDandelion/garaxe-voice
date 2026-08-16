import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database'
import { withDatabaseUser } from './database'

export const authSchemaSql = `
CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

-- Compatibility bridge for the current project schema. A managed-Postgres
-- migration can promote organization_id onto projects without changing the
-- authorization API below.
CREATE TABLE IF NOT EXISTS project_organizations (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memberships_user_idx ON organization_memberships(user_id, organization_id);
CREATE INDEX IF NOT EXISTS project_organizations_org_idx ON project_organizations(organization_id, project_id);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at DESC);
`

export type OrganizationRole = 'owner' | 'admin' | 'analyst' | 'viewer'

export type AuthContext = {
  sessionId: string
  user: { id: string; email: string; displayName: string }
  memberships: Array<{ organizationId: string; organizationName: string; role: OrganizationRole }>
  verifiedIdentityEmail?: string
}

export type VerifiedAuthClaims = { sub: string; sessionId: string; email: string }
export type VerifyAuthClaims = (token: string) => Promise<VerifiedAuthClaims>
type SupabaseGetClaims = (jwt: string) => Promise<{
  data: { claims?: Record<string, unknown> | null } | null
  error: unknown
}>

type SupabaseAuthEnvironment = {
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
  }
}

const TOKEN_BYTES = 32
const DEFAULT_SESSION_SECONDS = 60 * 60 * 24 * 30

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function parseBearerToken(request: Pick<IncomingMessage, 'headers'>) {
  const value = request.headers.authorization
  if (value) {
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(value)
    if (!match) throw new AuthError('AUTHORIZATION_INVALID', 'Authorization must use a valid Bearer token.', 401)
    return match[1]
  }
  const cookie = request.headers.cookie
  const session = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('garaxe_session='))
  const token = session?.slice('garaxe_session='.length)
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null
}

async function loadAuthContext(database: Database, userId: string, sessionId: string): Promise<AuthContext> {
  const identity = await database.query<{ userId: string; email: string; displayName: string }>(
    `SELECT id AS "userId", email, display_name AS "displayName" FROM auth_users WHERE id = $1`, [userId],
  )
  const user = identity.rows[0]
  if (!user) throw new AuthError('ACCOUNT_NOT_PROVISIONED', 'Voice Lab could not prepare your personal workspace. Contact support.', 403)
  const memberships = await database.query<{
    organizationId: string
    organizationName: string
    role: OrganizationRole
  }>(
    `SELECT m.organization_id AS "organizationId", o.name AS "organizationName", m.role
     FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1 ORDER BY o.name, o.id`,
    [userId],
  )
  return {
    sessionId,
    user: { id: user.userId, email: user.email, displayName: user.displayName },
    memberships: memberships.rows,
  }
}

async function provisionPersonalWorkspace(database: Database, claims: VerifiedAuthClaims) {
  const email = claims.email.trim().toLowerCase()
  if (!email) throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  const displayName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const organizationId = randomUUID()
  const projectId = randomUUID()
  await database.transaction(async (transaction) => {
    const created = await transaction.query(
      `INSERT INTO auth_users (id, email, display_name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [claims.sub, email, displayName],
    )
    if (!created.rows[0]) return
    await transaction.query('INSERT INTO organizations (id, name) VALUES ($1,$2)', [organizationId, 'Personal workspace'])
    await transaction.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')`,
      [organizationId, claims.sub],
    )
    await transaction.query(
      `INSERT INTO projects (id, name, primary_decision) VALUES ($1,$2,$3)`,
      [projectId, 'Default project', 'explore'],
    )
    await transaction.query(
      'INSERT INTO project_organizations (project_id, organization_id) VALUES ($1,$2)',
      [projectId, organizationId],
    )
  })
}

export async function authenticateVerifiedToken(
  database: Database,
  token: string,
  verifyClaims: VerifyAuthClaims,
): Promise<AuthContext> {
  let claims: VerifiedAuthClaims
  try {
    claims = await verifyClaims(token)
  } catch {
    throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub)
    || !claims.sessionId?.trim()) {
    throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  }
  const verifiedIdentityEmail = claims.email.trim().toLowerCase()
  const scopedDatabase = withDatabaseUser(database, claims.sub)
  let context: AuthContext
  try {
    context = await loadAuthContext(scopedDatabase, claims.sub, claims.sessionId)
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'ACCOUNT_NOT_PROVISIONED') throw error
    await provisionPersonalWorkspace(scopedDatabase, claims)
    context = await loadAuthContext(scopedDatabase, claims.sub, claims.sessionId)
  }
  if (!verifiedIdentityEmail || context.user.email.trim().toLowerCase() !== verifiedIdentityEmail) {
    throw new AuthError('ACCOUNT_IDENTITY_MISMATCH', 'This sign-in does not match the provisioned Voice Lab profile.', 403)
  }
  return { ...context, verifiedIdentityEmail }
}

export function createSupabaseClaimsVerifier(getClaims: SupabaseGetClaims): VerifyAuthClaims {
  return async (token) => {
    const result = await getClaims(token)
    const sub = result.data?.claims?.sub
    const sessionId = result.data?.claims?.session_id
    const email = result.data?.claims?.email
    if (result.error || typeof sub !== 'string' || typeof sessionId !== 'string' || typeof email !== 'string') {
      throw new Error('Invalid Supabase access token.')
    }
    return { sub, sessionId, email }
  }
}

export function supabaseAuthConfiguration(environment: SupabaseAuthEnvironment) {
  const url = environment.SUPABASE_URL?.trim()
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !publishableKey) return null
  if (!url || !publishableKey) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together.')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) {
    throw new Error('SUPABASE_URL must use HTTPS or loopback HTTP.')
  }
  return { url: url.replace(/\/$/, ''), publishableKey }
}

let cachedSupabaseVerifier: { key: string; verifier: VerifyAuthClaims } | null = null

export function configuredSupabaseClaimsVerifier(environment: SupabaseAuthEnvironment = process.env) {
  const configuration = supabaseAuthConfiguration(environment)
  if (!configuration) return undefined
  const key = `${configuration.url}\n${configuration.publishableKey}`
  if (cachedSupabaseVerifier?.key === key) return cachedSupabaseVerifier.verifier
  const client = createClient(configuration.url, configuration.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  const verifier = createSupabaseClaimsVerifier(async (token) => {
    const { data, error } = await client.auth.getClaims(token)
    return { data: { claims: data?.claims as Record<string, unknown> | undefined }, error }
  })
  cachedSupabaseVerifier = { key, verifier }
  return verifier
}

export async function createIdentity(
  database: Database,
  input: { email: string; displayName: string; organizationName: string; role?: OrganizationRole },
) {
  const email = input.email.trim().toLowerCase()
  const displayName = input.displayName.trim()
  const organizationName = input.organizationName.trim()
  if (!email || !displayName || !organizationName) throw new AuthError('IDENTITY_INVALID', 'Identity fields are required.', 400)
  const userId = randomUUID()
  const organizationId = randomUUID()
  await database.transaction(async (transaction) => {
    await transaction.query('INSERT INTO auth_users (id, email, display_name) VALUES ($1,$2,$3)', [userId, email, displayName])
    await transaction.query('INSERT INTO organizations (id, name) VALUES ($1,$2)', [organizationId, organizationName])
    await transaction.query(
      'INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1,$2,$3)',
      [organizationId, userId, input.role || 'owner'],
    )
  })
  return { userId, organizationId }
}

export async function bindProjectToOrganization(database: Database, projectId: string, organizationId: string) {
  await database.query(
    'INSERT INTO project_organizations (project_id, organization_id) VALUES ($1,$2)',
    [projectId, organizationId],
  )
}

export async function createSession(database: Database, userId: string, lifetimeSeconds = DEFAULT_SESSION_SECONDS) {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 60) {
    throw new AuthError('SESSION_LIFETIME_INVALID', 'Session lifetime must be at least 60 seconds.', 400)
  }
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000).toISOString()
  await database.query(
    'INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)',
    [sessionId, userId, hashSessionToken(token), expiresAt],
  )
  // The plaintext token is intentionally returned exactly once and is never persisted.
  return { sessionId, token, expiresAt }
}

export async function revokeSession(database: Database, sessionId: string, userId: string) {
  const result = await database.query(
    'UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [sessionId, userId],
  )
  return result.rows.length === 1
}

export async function authenticateToken(database: Database, token: string): Promise<AuthContext> {
  const result = await database.query<{
    sessionId: string
    userId: string
    email: string
    displayName: string
  }>(
    `SELECT s.id AS "sessionId", u.id AS "userId", u.email, u.display_name AS "displayName"
     FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
    [hashSessionToken(token)],
  )
  const identity = result.rows[0]
  if (!identity) throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  await database.query('UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = $1', [identity.sessionId])
  return loadAuthContext(database, identity.userId, identity.sessionId)
}

export async function authenticateRequest(
  database: Database,
  request: Pick<IncomingMessage, 'headers'>,
  verifyClaims?: VerifyAuthClaims,
) {
  const token = parseBearerToken(request)
  if (!token) throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  if (verifyClaims) return authenticateVerifiedToken(database, token, verifyClaims)
  return authenticateToken(database, token)
}

export function requireOrganizationMembership(context: AuthContext, organizationId: string, roles?: OrganizationRole[]) {
  const membership = context.memberships.find((item) => item.organizationId === organizationId)
  if (!membership || (roles && !roles.includes(membership.role))) {
    // Deliberately conceal whether the tenant exists.
    throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
  }
  return membership
}

async function organizationForResource(database: Database, type: 'project' | 'analysisRun' | 'report', id: string) {
  const query = type === 'project'
    ? `SELECT organization_id AS "organizationId" FROM project_organizations WHERE project_id = $1`
    : type === 'analysisRun'
      ? `SELECT po.organization_id AS "organizationId" FROM analysis_runs ar
         JOIN project_organizations po ON po.project_id = ar.project_id WHERE ar.id = $1`
      : `SELECT po.organization_id AS "organizationId" FROM reports r
         JOIN project_organizations po ON po.project_id = r.project_id WHERE r.id = $1`
  const result = await database.query<{ organizationId: string }>(query, [id])
  return result.rows[0]?.organizationId || null
}

async function authorizeResource(database: Database, context: AuthContext, type: 'project' | 'analysisRun' | 'report', id: string, roles?: OrganizationRole[]) {
  const organizationId = await organizationForResource(database, type, id)
  if (!organizationId) throw new AuthError('RESOURCE_NOT_FOUND', 'Resource not found.', 404)
  const membership = requireOrganizationMembership(context, organizationId, roles)
  return { organizationId, membership }
}

export const authorizeProject = (database: Database, context: AuthContext, projectId: string, roles?: OrganizationRole[]) =>
  authorizeResource(database, context, 'project', projectId, roles)

export const authorizeAnalysisRun = (database: Database, context: AuthContext, runId: string, roles?: OrganizationRole[]) =>
  authorizeResource(database, context, 'analysisRun', runId, roles)

export const authorizeReport = (database: Database, context: AuthContext, reportId: string, roles?: OrganizationRole[]) =>
  authorizeResource(database, context, 'report', reportId, roles)
