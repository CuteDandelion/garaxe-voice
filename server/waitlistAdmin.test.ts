// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { authSchemaSql, type AuthContext } from './auth'
import { schemaSql } from './schema'
import { listWaitlistSignups } from './waitlistAdmin'

let database: PGlite

function identity(email: string, verifiedIdentityEmail?: string): AuthContext {
  return {
    sessionId: 'verified-session',
    user: { id: randomUUID(), email, displayName: 'Admin' },
    memberships: [],
    verifiedIdentityEmail,
  }
}

beforeEach(async () => {
  database = new PGlite()
  await database.exec(schemaSql)
  await database.exec(authSchemaSql)
  await database.exec(`
    INSERT INTO waitlist_signups (id, name, email_normalized, consent_version, created_at) VALUES
      ('10000000-0000-4000-8000-000000000001', 'First person', 'first@example.com', 'voice-lab-waitlist-v1', '2026-08-10T10:00:00Z'),
      ('10000000-0000-4000-8000-000000000002', 'Second person', 'second@example.com', 'voice-lab-waitlist-v1', '2026-08-11T10:00:00Z'),
      ('10000000-0000-4000-8000-000000000003', 'Third person', 'third@example.com', 'voice-lab-waitlist-v1', '2026-08-12T10:00:00Z');
  `)
})

describe('private waitlist monitoring', () => {
  it('requires a verified Supabase identity', async () => {
    await expect(listWaitlistSignups(database, null, { VOICE_LAB_ADMIN_EMAILS: 'admin@example.com' }, { limit: 25, offset: 0 }))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 })
    await expect(listWaitlistSignups(database, identity('admin@example.com'), { VOICE_LAB_ADMIN_EMAILS: 'admin@example.com' }, { limit: 25, offset: 0 }))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 })
  })

  it('denies non-admin and mismatched provisioned identities', async () => {
    await expect(listWaitlistSignups(database, identity('member@example.com', 'member@example.com'), { VOICE_LAB_ADMIN_EMAILS: 'admin@example.com' }, { limit: 25, offset: 0 }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_FORBIDDEN', status: 403 })
    await expect(listWaitlistSignups(database, identity('profile@example.com', 'admin@example.com'), { VOICE_LAB_ADMIN_EMAILS: 'admin@example.com' }, { limit: 25, offset: 0 }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_FORBIDDEN', status: 403 })
  })

  it('normalizes the server allowlist and returns count plus stable pages without internal IDs', async () => {
    const auth = identity('admin@example.com', ' ADMIN@EXAMPLE.COM ')
    const first = await listWaitlistSignups(database, auth, { VOICE_LAB_ADMIN_EMAILS: 'other@example.com, ADMIN@example.com' }, { limit: 2, offset: 0 })
    expect(first).toEqual({
      total: 3,
      limit: 2,
      offset: 0,
      items: [
        { name: 'Third person', email: 'third@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-12T10:00:00.000Z' },
        { name: 'Second person', email: 'second@example.com', consentVersion: 'voice-lab-waitlist-v1', createdAt: '2026-08-11T10:00:00.000Z' },
      ],
    })
    expect(await listWaitlistSignups(database, auth, { VOICE_LAB_ADMIN_EMAILS: 'admin@example.com' }, { limit: 2, offset: 2 }))
      .toMatchObject({ total: 3, limit: 2, offset: 2, items: [{ name: 'First person', email: 'first@example.com' }] })
    expect(Object.keys(first.items[0]).sort()).toEqual(['consentVersion', 'createdAt', 'email', 'name'])
  })
})
