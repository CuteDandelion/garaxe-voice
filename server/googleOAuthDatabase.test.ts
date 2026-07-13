// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { authSchemaSql, createIdentity } from './auth'
import type { Database } from './database'
import { DatabaseOAuthStateStore, googleOAuthSchemaSql } from './googleOAuth'
import { schemaSql } from './schema'

let database: PGlite

beforeEach(async () => {
  database = new PGlite()
  await database.exec(schemaSql)
  await database.exec(authSchemaSql)
  await database.exec(googleOAuthSchemaSql)
})

describe('persistent Google OAuth state', () => {
  it('atomically consumes an organization/user-bound state once', async () => {
    const identity = await createIdentity(database as unknown as Database, {
      email: 'oauth@example.com', displayName: 'OAuth Owner', organizationName: 'OAuth Org',
    })
    const store = new DatabaseOAuthStateStore(database as unknown as Database)
    const stateHash = randomUUID()
    await store.create({
      stateHash, organizationId: identity.organizationId, userId: identity.userId,
      encryptedCodeVerifier: 'encrypted', redirectUri: 'https://example.com/callback',
      expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
    })
    await expect(store.consume({ stateHash, organizationId: identity.organizationId, userId: identity.userId, now: new Date() })).resolves.toMatchObject({ stateHash, consumedAt: expect.any(Date) })
    await expect(store.consume({ stateHash, organizationId: identity.organizationId, userId: identity.userId, now: new Date() })).resolves.toBeNull()
  })
})
