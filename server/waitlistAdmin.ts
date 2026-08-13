import type { Database } from './database'
import { AuthError, type AuthContext } from './auth'

type WaitlistAdminEnvironment = { VOICE_LAB_ADMIN_EMAILS?: string }

function normalizedEmail(value: string | undefined) {
  return value?.trim().toLowerCase() || ''
}

export function isWaitlistAdmin(auth: AuthContext, environment: WaitlistAdminEnvironment = process.env) {
  const verifiedEmail = normalizedEmail(auth.verifiedIdentityEmail)
  if (!verifiedEmail || verifiedEmail !== normalizedEmail(auth.user.email)) return false
  return (environment.VOICE_LAB_ADMIN_EMAILS || '').split(',').map(normalizedEmail).includes(verifiedEmail)
}

export async function listWaitlistSignups(
  database: Database,
  auth: AuthContext | null,
  environment: WaitlistAdminEnvironment,
  page: { limit: number; offset: number },
) {
  if (!auth?.verifiedIdentityEmail) throw new AuthError('AUTHENTICATION_REQUIRED', 'A valid session is required.', 401)
  if (!isWaitlistAdmin(auth, environment)) throw new AuthError('AUTHORIZATION_FORBIDDEN', 'You do not have access to waitlist monitoring.', 403)
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 || !Number.isInteger(page.offset) || page.offset < 0) {
    throw new AuthError('WAITLIST_QUERY_INVALID', 'Waitlist pagination is invalid.', 400)
  }
  const [count, signups] = await Promise.all([
    database.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM waitlist_signups'),
    database.query<{ name: string; email: string; consentVersion: string; createdAt: string | Date }>(
      `SELECT name, email_normalized AS email, consent_version AS "consentVersion", created_at AS "createdAt"
       FROM waitlist_signups ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [page.limit, page.offset],
    ),
  ])
  return {
    total: count.rows[0]?.total || 0,
    limit: page.limit,
    offset: page.offset,
    items: signups.rows.map((item) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() })),
  }
}
