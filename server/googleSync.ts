import { createHash, randomUUID } from 'node:crypto'
import type { Database, DatabaseClient } from './database'
import type {
  CanonicalConnectorReview,
  GoogleBusinessAccount,
  GoogleBusinessConnector,
  GoogleBusinessEntity,
} from './connectors/googleBusiness'

type GoogleDiscoveryConnector = Pick<GoogleBusinessConnector, 'listAllAccounts' | 'listAllLocations'>
type GoogleReviewConnector = Pick<GoogleBusinessConnector, 'fetchAllReviews'>

export type PersistedGoogleEntity = {
  id: string
  connectionId: string
  externalId: string
  accountExternalId: string | null
  entityType: 'account' | 'location'
  name: string
  selected: boolean
  available: boolean
  metadata: Record<string, unknown>
  updatedAt: string
}

export const googleSyncSchemaSql = `
CREATE TABLE IF NOT EXISTS google_business_entities (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES google_business_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  account_external_id TEXT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('account', 'location')),
  name TEXT NOT NULL,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS google_entities_connection_type_idx
  ON google_business_entities(connection_id, entity_type, available, selected);

CREATE TABLE IF NOT EXISTS google_sync_job_entities (
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  google_entity_id UUID NOT NULL REFERENCES google_business_entities(id) ON DELETE RESTRICT,
  account_external_id TEXT NOT NULL,
  entity_external_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  PRIMARY KEY(import_job_id, google_entity_id),
  UNIQUE(import_job_id, entity_external_id)
);
CREATE INDEX IF NOT EXISTS google_sync_job_entities_job_idx
  ON google_sync_job_entities(import_job_id, entity_external_id);
`

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function accountMetadata(account: GoogleBusinessAccount) {
  return {
    type: account.type,
    role: account.role,
    verificationState: account.verificationState,
  }
}

async function upsertEntity(
  database: DatabaseClient,
  connectionId: string,
  entity: {
    externalId: string
    accountExternalId: string | null
    entityType: 'account' | 'location'
    name: string
    metadata: Record<string, unknown>
  },
) {
  await database.query(
    `INSERT INTO google_business_entities
      (id, connection_id, external_id, account_external_id, entity_type, name, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (connection_id, external_id) DO UPDATE SET
       account_external_id = EXCLUDED.account_external_id,
       entity_type = EXCLUDED.entity_type,
       name = EXCLUDED.name,
       metadata = EXCLUDED.metadata,
       available = TRUE,
       updated_at = NOW()`,
    [randomUUID(), connectionId, entity.externalId, entity.accountExternalId,
      entity.entityType, entity.name, JSON.stringify(entity.metadata)],
  )
}

/** Discovers every authorized account and location and keeps prior selection stable. */
export async function discoverGoogleEntities(
  database: Database,
  connectionId: string,
  connector: GoogleDiscoveryConnector,
) {
  const accounts = await connector.listAllAccounts()
  const locations: GoogleBusinessEntity[] = []
  for (const account of accounts) {
    locations.push(...await connector.listAllLocations(account.externalId))
  }

  await database.transaction(async (transaction) => {
    await transaction.query(
      `UPDATE google_business_entities SET available = FALSE, updated_at = NOW()
       WHERE connection_id = $1`,
      [connectionId],
    )
    for (const account of accounts) {
      await upsertEntity(transaction, connectionId, {
        externalId: account.externalId,
        accountExternalId: null,
        entityType: 'account',
        name: account.name,
        metadata: accountMetadata(account),
      })
    }
    for (const location of locations) {
      await upsertEntity(transaction, connectionId, {
        externalId: location.externalId,
        accountExternalId: location.accountExternalId,
        entityType: 'location',
        name: location.name,
        metadata: location.metadata,
      })
    }
  })
  return listGoogleEntities(database, connectionId)
}

export async function listGoogleEntities(database: DatabaseClient, connectionId: string) {
  const result = await database.query<PersistedGoogleEntity>(
    `SELECT id, connection_id AS "connectionId", external_id AS "externalId",
       account_external_id AS "accountExternalId", entity_type AS "entityType", name,
       selected, available, metadata, updated_at AS "updatedAt"
     FROM google_business_entities
     WHERE connection_id = $1
     ORDER BY CASE entity_type WHEN 'account' THEN 0 ELSE 1 END, name, external_id`,
    [connectionId],
  )
  return result.rows
}

/** Replaces the selected-location set only after proving all IDs belong to this connection. */
export async function updateSelectedGoogleLocations(
  database: Database,
  connectionId: string,
  entityExternalIds: string[],
) {
  const requested = [...new Set(entityExternalIds)]
  return database.transaction(async (transaction) => {
    if (requested.length > 0) {
      const owned = await transaction.query<{ externalId: string }>(
        `SELECT external_id AS "externalId" FROM google_business_entities
         WHERE connection_id = $1 AND entity_type = 'location' AND available = TRUE
           AND external_id = ANY($2::text[])`,
        [connectionId, requested],
      )
      const found = new Set(owned.rows.map((row) => row.externalId))
      const invalid = requested.filter((externalId) => !found.has(externalId))
      if (invalid.length > 0) {
        throw new Error('One or more Google Business locations do not belong to this connection.')
      }
    }
    await transaction.query(
      `UPDATE google_business_entities SET selected = FALSE, updated_at = NOW()
       WHERE connection_id = $1 AND entity_type = 'location'`,
      [connectionId],
    )
    if (requested.length > 0) {
      await transaction.query(
        `UPDATE google_business_entities SET selected = TRUE, updated_at = NOW()
         WHERE connection_id = $1 AND external_id = ANY($2::text[])`,
        [connectionId, requested],
      )
    }
    return listGoogleEntities(transaction, connectionId)
  })
}

type SelectedEntity = {
  id: string
  accountExternalId: string
  entityExternalId: string
  entityName: string
}

async function selectedLocations(database: DatabaseClient, connectionId: string) {
  const result = await database.query<SelectedEntity>(
    `SELECT id, account_external_id AS "accountExternalId", external_id AS "entityExternalId",
       name AS "entityName"
     FROM google_business_entities
     WHERE connection_id = $1 AND entity_type = 'location' AND available = TRUE AND selected = TRUE
     ORDER BY external_id`,
    [connectionId],
  )
  return result.rows
}

/** Creates a queued import with a non-secret, immutable snapshot of selected locations. */
export async function createGoogleSyncImportJob(database: Database, input: {
  projectId: string
  connectionId: string
}) {
  const connection = await database.query<{ id: string }>(
    `SELECT id FROM google_business_connections WHERE id = $1 AND project_id = $2 AND status = 'connected'`,
    [input.connectionId, input.projectId],
  )
  if (!connection.rows[0]) throw new Error('Connected Google Business connection not found for this project.')
  const entities = await selectedLocations(database, input.connectionId)
  if (entities.length === 0) throw new Error('Select at least one Google Business location before syncing.')

  const jobId = randomUUID()
  const source = Buffer.from(JSON.stringify({
    provider: 'google_business',
    connectionId: input.connectionId,
    entities: entities.map(({ accountExternalId, entityExternalId, entityName }) => ({
      accountExternalId, entityExternalId, entityName,
    })),
  }))
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO import_jobs
        (id, project_id, file_name, status, total_rows, source_media_type,
         source_encoding, source_content, source_hash)
       VALUES ($1,$2,$3,'queued',0,$4,'utf8',$5,$6)`,
      [jobId, input.projectId, 'google-business-sync.json',
        'application/vnd.garaxe.google-business-sync+json', source, sha256(source)],
    )
    for (const entity of entities) {
      await transaction.query(
        `INSERT INTO google_sync_job_entities
          (import_job_id, google_entity_id, account_external_id, entity_external_id, entity_name)
         VALUES ($1,$2,$3,$4,$5)`,
        [jobId, entity.id, entity.accountExternalId, entity.entityExternalId, entity.entityName],
      )
    }
  })
  return { jobId, selectedLocationCount: entities.length }
}

function reviewMetadata(review: CanonicalConnectorReview, entity: SelectedEntity) {
  return {
    ...review.metadata,
    entityExternalId: review.entityExternalId,
    accountExternalId: entity.accountExternalId,
    sourceUpdatedAt: review.sourceUpdatedAt,
    replyUpdatedAt: review.replyUpdatedAt,
    deleted: review.flags.deleted,
  }
}

async function upsertReview(database: DatabaseClient, input: {
  projectId: string
  sourceRecordId: string
  entity: SelectedEntity
  review: CanonicalConnectorReview
}) {
  const { review, entity } = input
  // Provider + location + provider review ID is the durable identity. Text/rating edits
  // update this record, while equal IDs from different locations can never collapse.
  const canonicalHash = sha256(`google_business\0${review.entityExternalId}\0${review.externalReviewId}`)
  await database.query(
    `INSERT INTO reviews (
      id, project_id, source_record_id, external_review_id, provider, entity_name,
      rating_value, rating_scale, title, body_original, language, reviewer_name,
      owner_reply, source_url, source_created_at, is_rating_only, canonical_hash, metadata
    ) VALUES ($1,$2,$3,$4,'google_business',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
    ON CONFLICT (project_id, canonical_hash) DO UPDATE SET
      source_record_id = EXCLUDED.source_record_id,
      external_review_id = EXCLUDED.external_review_id,
      provider = EXCLUDED.provider,
      entity_name = EXCLUDED.entity_name,
      rating_value = EXCLUDED.rating_value,
      rating_scale = EXCLUDED.rating_scale,
      title = EXCLUDED.title,
      body_original = EXCLUDED.body_original,
      language = EXCLUDED.language,
      reviewer_name = EXCLUDED.reviewer_name,
      owner_reply = EXCLUDED.owner_reply,
      source_url = EXCLUDED.source_url,
      source_created_at = EXCLUDED.source_created_at,
      is_rating_only = EXCLUDED.is_rating_only,
      metadata = EXCLUDED.metadata`,
    [randomUUID(), input.projectId, input.sourceRecordId, review.externalReviewId, entity.entityName,
      review.ratingValue, review.ratingScale, review.title, review.bodyOriginal, review.language,
      review.metadata.reviewerDisplayName, review.replyBody, null, review.sourceCreatedAt,
      review.flags.ratingOnly, canonicalHash, JSON.stringify(reviewMetadata(review, entity))],
  )
}

/** Exhausts every provider page for the job's frozen location selection. */
export async function processGoogleSyncImportJob(
  database: Database,
  jobId: string,
  connector: GoogleReviewConnector,
) {
  const jobResult = await database.query<{ projectId: string; status: string }>(
    `SELECT project_id AS "projectId", status FROM import_jobs WHERE id = $1`, [jobId],
  )
  const job = jobResult.rows[0]
  if (!job) throw new Error('Google sync import job not found.')
  if (job.status === 'completed') return
  const entityResult = await database.query<SelectedEntity>(
    `SELECT google_entity_id AS id, account_external_id AS "accountExternalId",
       entity_external_id AS "entityExternalId", entity_name AS "entityName"
     FROM google_sync_job_entities WHERE import_job_id = $1 ORDER BY entity_external_id`,
    [jobId],
  )

  await database.query(`UPDATE import_jobs SET status = 'processing', error_message = NULL WHERE id = $1`, [jobId])
  try {
    const batches: Array<{ entity: SelectedEntity; reviews: CanonicalConnectorReview[] }> = []
    let totalRows = 0
    for (const entity of entityResult.rows) {
      const reviews = await connector.fetchAllReviews({
        accountExternalId: entity.accountExternalId,
        entityExternalId: entity.entityExternalId,
        pageSize: 50,
      })
      batches.push({ entity, reviews })
      totalRows += reviews.length
    }
    await database.query(`UPDATE import_jobs SET total_rows = $2 WHERE id = $1`, [jobId, totalRows])

    let processed = 0
    let written = 0
    let ratingOnly = 0
    let duplicates = 0
    const seen = new Set<string>()
    for (const batch of batches) {
      for (const review of batch.reviews) {
        processed += 1
        const rawPayload = JSON.stringify(review.rawPayload)
        const sourceRecordId = randomUUID()
        await database.query(
          `INSERT INTO review_source_records
            (id, import_job_id, project_id, row_number, raw_payload, payload_hash)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
          [sourceRecordId, jobId, job.projectId, processed, rawPayload, sha256(rawPayload)],
        )
        const identity = `${review.entityExternalId}\0${review.externalReviewId}`
        if (seen.has(identity)) {
          duplicates += 1
        } else {
          seen.add(identity)
          await upsertReview(database, {
            projectId: job.projectId,
            sourceRecordId,
            entity: batch.entity,
            review,
          })
          if (review.flags.ratingOnly) ratingOnly += 1
          else written += 1
        }
        await database.query(`UPDATE import_jobs SET processed_rows = $2 WHERE id = $1`, [jobId, processed])
      }
    }
    await database.query(
      `UPDATE import_jobs SET status = 'completed', processed_rows = total_rows,
         usable_rows = $2, written_rows = $3, rating_only_rows = $4,
         duplicate_rows = $5, invalid_rows = 0, completed_at = NOW()
       WHERE id = $1`,
      [jobId, seen.size, written, ratingOnly, duplicates],
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Business sync failed.'
    await database.query(
      `UPDATE import_jobs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
      [jobId, message],
    )
    throw error
  }
}
