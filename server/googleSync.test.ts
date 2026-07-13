// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authSchemaSql, createIdentity } from './auth'
import type { Database } from './database'
import { GoogleBusinessConnector, type CanonicalConnectorReview } from './connectors/googleBusiness'
import { googleOAuthSchemaSql } from './googleOAuth'
import {
  createGoogleSyncImportJob,
  discoverGoogleEntities,
  googleSyncSchemaSql,
  listGoogleEntities,
  processGoogleSyncImportJob,
  updateSelectedGoogleLocations,
} from './googleSync'
import { schemaSql } from './schema'

let pglite: PGlite
let database: Database
let projectId: string
let connectionId: string

beforeEach(async () => {
  pglite = new PGlite()
  database = pglite as unknown as Database
  await database.exec(schemaSql)
  await database.exec(authSchemaSql)
  await database.exec(googleOAuthSchemaSql)
  await database.exec(googleSyncSchemaSql)
  const identity = await createIdentity(database, {
    email: 'sync@example.com', displayName: 'Sync Owner', organizationName: 'Sync Org',
  })
  projectId = randomUUID()
  connectionId = randomUUID()
  await database.query(`INSERT INTO projects (id, name, primary_decision) VALUES ($1,'Sync project','Learn')`, [projectId])
  await database.query(`INSERT INTO project_organizations (project_id, organization_id) VALUES ($1,$2)`, [projectId, identity.organizationId])
  await database.query(
    `INSERT INTO google_business_connections
      (id, organization_id, project_id, connected_by_user_id, encrypted_access_token,
       encrypted_refresh_token, granted_scope, status)
     VALUES ($1,$2,$3,$4,'encrypted-access','encrypted-refresh','business.manage','connected')`,
    [connectionId, identity.organizationId, projectId, identity.userId],
  )
})

function discoveryConnector() {
  return {
    listAllAccounts: vi.fn(async () => [{
      externalId: 'accounts/1', name: 'Acme', type: 'BUSINESS', role: 'OWNER', verificationState: 'VERIFIED',
    }]),
    listAllLocations: vi.fn(async () => [
      { externalId: 'locations/one', accountExternalId: 'accounts/1', type: 'location' as const, name: 'Berlin', metadata: { storefrontAddress: { locality: 'Berlin' }, languageCode: 'de' } },
      { externalId: 'locations/two', accountExternalId: 'accounts/1', type: 'location' as const, name: 'Hamburg', metadata: { storefrontAddress: null, languageCode: 'de' } },
    ]),
  }
}

async function discoverAndSelect(ids = ['locations/one']) {
  await discoverGoogleEntities(database, connectionId, discoveryConnector())
  await updateSelectedGoogleLocations(database, connectionId, ids)
}

function canonicalReview(overrides: Partial<CanonicalConnectorReview> = {}): CanonicalConnectorReview {
  const rawPayload = {
    reviewId: 'review-1', starRating: 'FIVE', comment: 'Warm and attentive.',
    createTime: '2026-07-01T10:00:00Z', updateTime: '2026-07-02T10:00:00Z',
    reviewer: { displayName: 'Customer One' },
    reviewReply: { comment: 'Thank you.', updateTime: '2026-07-03T10:00:00Z' },
  }
  return {
    provider: 'google_business', externalReviewId: 'review-1', entityExternalId: 'locations/one',
    ratingValue: 5, ratingScale: 5, title: null, bodyOriginal: 'Warm and attentive.', language: null,
    sourceCreatedAt: '2026-07-01T10:00:00Z', sourceUpdatedAt: '2026-07-02T10:00:00Z',
    replyBody: 'Thank you.', replyUpdatedAt: '2026-07-03T10:00:00Z',
    flags: { ratingOnly: false, deleted: false },
    metadata: { reviewerDisplayName: 'Customer One', reviewerProfilePhotoUrl: null }, rawPayload,
    ...overrides,
  }
}

describe('Google Business discovery and selection', () => {
  it('upserts all accounts and locations while retaining selection', async () => {
    const connector = discoveryConnector()
    const first = await discoverGoogleEntities(database, connectionId, connector)
    expect(first.map((entity) => [entity.entityType, entity.externalId])).toEqual([
      ['account', 'accounts/1'], ['location', 'locations/one'], ['location', 'locations/two'],
    ])
    await updateSelectedGoogleLocations(database, connectionId, ['locations/two'])
    connector.listAllLocations.mockResolvedValueOnce([
      { externalId: 'locations/two', accountExternalId: 'accounts/1', type: 'location', name: 'Hamburg renamed', metadata: { storefrontAddress: null, languageCode: 'de' } },
    ])
    const second = await discoverGoogleEntities(database, connectionId, connector)
    expect(second.find((entity) => entity.externalId === 'locations/two')).toMatchObject({ name: 'Hamburg renamed', selected: true, available: true })
    expect(second.find((entity) => entity.externalId === 'locations/one')).toMatchObject({ selected: false, available: false })
  })

  it('rejects selections belonging to another connection without changing existing selection', async () => {
    await discoverAndSelect(['locations/one'])
    await expect(updateSelectedGoogleLocations(database, connectionId, ['locations/not-owned']))
      .rejects.toThrow('do not belong')
    const entities = await listGoogleEntities(database, connectionId)
    expect(entities.filter((entity) => entity.selected).map((entity) => entity.externalId)).toEqual(['locations/one'])
  })
})

describe('Google Business review synchronization', () => {
  it('exhausts provider pagination and preserves raw reviews, replies, rating-only state, and safe source metadata', async () => {
    await discoverAndSelect(['locations/one'])
    const rawWritten = {
      reviewId: 'written', starRating: 'FOUR', comment: 'Friendly staff, long wait.',
      createTime: '2026-06-01T09:00:00Z', updateTime: '2026-06-02T09:00:00Z',
      reviewer: { displayName: 'Anna' }, reviewReply: { comment: 'We are improving.', updateTime: '2026-06-03T09:00:00Z' },
    }
    const rawRatingOnly = {
      reviewId: 'rating-only', starRating: 'TWO', createTime: '2026-06-04T09:00:00Z',
      updateTime: '2026-06-04T09:00:00Z', reviewer: { displayName: 'Bo' },
    }
    const requestedTokens: Array<string | null> = []
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input))
      if (!url.pathname.endsWith('/reviews')) throw new Error(`Unexpected ${url}`)
      requestedTokens.push(url.searchParams.get('pageToken'))
      return Response.json(url.searchParams.get('pageToken') ? { reviews: [rawRatingOnly] } : {
        reviews: [rawWritten], nextPageToken: 'page-2',
      })
    })
    const connector = new GoogleBusinessConnector({ getAccessToken: async () => 'access-token', fetch: fetcher })
    const { jobId } = await createGoogleSyncImportJob(database, { projectId, connectionId })
    await processGoogleSyncImportJob(database, jobId, connector)

    expect(requestedTokens).toEqual([null, 'page-2'])
    const sourceRecords = await database.query<{ rawPayload: unknown }>(
      `SELECT raw_payload AS "rawPayload" FROM review_source_records WHERE import_job_id = $1 ORDER BY row_number`, [jobId],
    )
    expect(sourceRecords.rows.map((row) => row.rawPayload)).toEqual([rawWritten, rawRatingOnly])
    const reviews = await database.query<{
      externalId: string; body: string | null; ownerReply: string | null; ratingOnly: boolean; metadata: Record<string, unknown>
    }>(
      `SELECT external_review_id AS "externalId", body_original AS body, owner_reply AS "ownerReply",
         is_rating_only AS "ratingOnly", metadata FROM reviews WHERE project_id = $1 ORDER BY external_review_id`, [projectId],
    )
    expect(reviews.rows).toEqual([
      expect.objectContaining({ externalId: 'rating-only', body: null, ownerReply: null, ratingOnly: true }),
      expect.objectContaining({ externalId: 'written', body: 'Friendly staff, long wait.', ownerReply: 'We are improving.', ratingOnly: false,
        metadata: expect.objectContaining({ sourceUpdatedAt: '2026-06-02T09:00:00Z', replyUpdatedAt: '2026-06-03T09:00:00Z' }) }),
    ])
    const job = await database.query<Record<string, unknown>>(
      `SELECT status, total_rows, processed_rows, usable_rows, written_rows, rating_only_rows,
         duplicate_rows, invalid_rows, source_content FROM import_jobs WHERE id = $1`, [jobId],
    )
    expect(job.rows[0]).toMatchObject({ status: 'completed', total_rows: 2, processed_rows: 2, usable_rows: 2, written_rows: 1, rating_only_rows: 1, duplicate_rows: 0, invalid_rows: 0 })
    const artifact = JSON.parse(Buffer.from(job.rows[0].source_content as Uint8Array).toString('utf8'))
    expect(artifact).toEqual({ provider: 'google_business', connectionId, entities: [{ accountExternalId: 'accounts/1', entityExternalId: 'locations/one', entityName: 'Berlin' }] })
    expect(JSON.stringify(artifact)).not.toMatch(/access-token|refresh|encrypted/i)
  })

  it('updates a stable review on re-sync without duplicate review or evidence identity', async () => {
    await discoverAndSelect()
    const firstConnector = { fetchAllReviews: vi.fn(async () => [canonicalReview()]) }
    const first = await createGoogleSyncImportJob(database, { projectId, connectionId })
    await processGoogleSyncImportJob(database, first.jobId, firstConnector)
    const initial = await database.query<{ id: string; sourceRecordId: string }>(
      `SELECT id, source_record_id AS "sourceRecordId" FROM reviews WHERE project_id = $1`, [projectId],
    )

    const changedRaw = { reviewId: 'review-1', starRating: 'THREE', comment: 'Now edited.' }
    const changed = canonicalReview({
      ratingValue: 3, bodyOriginal: 'Now edited.', sourceUpdatedAt: '2026-07-10T10:00:00Z', rawPayload: changedRaw,
    })
    const second = await createGoogleSyncImportJob(database, { projectId, connectionId })
    await processGoogleSyncImportJob(database, second.jobId, { fetchAllReviews: vi.fn(async () => [changed]) })

    const current = await database.query<{ id: string; sourceRecordId: string; body: string; rating: number }>(
      `SELECT id, source_record_id AS "sourceRecordId", body_original AS body, rating_value AS rating
       FROM reviews WHERE project_id = $1`, [projectId],
    )
    expect(current.rows).toHaveLength(1)
    expect(current.rows[0]).toMatchObject({ id: initial.rows[0].id, body: 'Now edited.', rating: 3 })
    expect(current.rows[0].sourceRecordId).not.toBe(initial.rows[0].sourceRecordId)
    const sources = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM review_source_records WHERE project_id = $1`, [projectId],
    )
    expect(sources.rows[0].count).toBe(2)
    const secondJob = await database.query<{ usable: number; duplicates: number }>(
      `SELECT usable_rows AS usable, duplicate_rows AS duplicates FROM import_jobs WHERE id = $1`, [second.jobId],
    )
    expect(secondJob.rows[0]).toEqual({ usable: 1, duplicates: 0 })
  })

  it('uses location identity so equal provider review IDs at different locations never merge', async () => {
    await discoverAndSelect(['locations/one', 'locations/two'])
    const connector = {
      fetchAllReviews: vi.fn(async (input: { entityExternalId: string }) => [canonicalReview({
        entityExternalId: input.entityExternalId,
        rawPayload: { reviewId: 'review-1', location: input.entityExternalId },
      })]),
    }
    const job = await createGoogleSyncImportJob(database, { projectId, connectionId })
    await processGoogleSyncImportJob(database, job.jobId, connector)
    const count = await database.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM reviews WHERE project_id = $1`, [projectId])
    expect(count.rows[0].count).toBe(2)
  })
})
