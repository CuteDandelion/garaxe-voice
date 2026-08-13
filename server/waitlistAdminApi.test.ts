// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRequest } from './app'
import { createIdentity } from './auth'
import { getDatabase, resetDatabaseForTests } from './db'

let server: Server
let baseUrl = ''
let adminId = ''
let memberId = ''
const previousAllowlist = process.env.VOICE_LAB_ADMIN_EMAILS

beforeAll(async () => {
  await resetDatabaseForTests()
  const database = await getDatabase()
  adminId = (await createIdentity(database, { email: 'admin@example.com', displayName: 'Admin', organizationName: 'Admin Org' })).userId
  memberId = (await createIdentity(database, { email: 'member@example.com', displayName: 'Member', organizationName: 'Member Org' })).userId
  await database.query(
    `INSERT INTO waitlist_signups (id, name, email_normalized, consent_version, created_at) VALUES
     ($1, 'Private signup', 'signup@example.com', 'voice-lab-waitlist-v1', '2026-08-12T10:00:00Z')`,
    [randomUUID()],
  )
  process.env.VOICE_LAB_ADMIN_EMAILS = ' ADMIN@example.com '
  server = createServer((request, response) => void handleRequest(request, response, {
    verifyClaims: async (token) => {
      if (token === 'admin.jwt.token') return { sub: adminId, sessionId: 'admin-session', email: 'admin@example.com' }
      if (token === 'member.jwt.token') return { sub: memberId, sessionId: 'member-session', email: 'member@example.com' }
      return { sub: randomUUID(), sessionId: 'unknown-session', email: 'unknown@example.com' }
    },
  }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (previousAllowlist === undefined) delete process.env.VOICE_LAB_ADMIN_EMAILS
  else process.env.VOICE_LAB_ADMIN_EMAILS = previousAllowlist
})

describe('private waitlist monitoring API', () => {
  it('allows only the verified allowlisted profile and preserves private pagination', async () => {
    const missing = await fetch(`${baseUrl}/api/admin/waitlist`)
    expect(missing.status).toBe(401)

    const denied = await fetch(`${baseUrl}/api/admin/waitlist`, { headers: { authorization: 'Bearer member.jwt.token' } })
    expect(denied.status).toBe(403)

    const unprovisioned = await fetch(`${baseUrl}/api/admin/waitlist`, { headers: { authorization: 'Bearer unknown.jwt.token' } })
    expect(unprovisioned.status).toBe(403)

    const allowed = await fetch(`${baseUrl}/api/admin/waitlist?limit=1&offset=0`, { headers: { authorization: 'Bearer admin.jwt.token' } })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({ data: {
      total: 1, limit: 1, offset: 0,
      items: [{ name: 'Private signup', email: 'signup@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-12T10:00:00.000Z' }],
    } })
  })
})
