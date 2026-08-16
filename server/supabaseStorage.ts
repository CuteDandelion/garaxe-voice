import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database'

export const ARTIFACT_BUCKETS = { csv: 'voice-lab-uploads', pdf: 'voice-lab-reports' } as const

export const artifactStorageSchemaSql = `
CREATE TABLE IF NOT EXISTS artifact_objects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('csv', 'pdf')),
  bucket_id TEXT NOT NULL CHECK (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')),
  object_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact_deletion_queue (
  id UUID PRIMARY KEY,
  artifact_object_id UUID NOT NULL UNIQUE REFERENCES artifact_objects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'deleted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifact_objects_project_created_idx ON artifact_objects(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_deletion_queue_status_idx ON artifact_deletion_queue(status, scheduled_at);
`

type ArtifactStoreConfiguration = { url: string; publishableKey: string; accessToken: string }
type ClientFactory = typeof createClient
type ArtifactLocation = { organizationId: string; projectId: string }

function configured(configuration: ArtifactStoreConfiguration) {
  const url = configuration.url.trim().replace(/\/$/, '')
  const publishableKey = configuration.publishableKey.trim()
  const accessToken = configuration.accessToken.trim()
  if (!url || !publishableKey || !accessToken || new URL(url).protocol !== 'https:') {
    throw new Error('Supabase artifact storage is not configured.')
  }
  return { url, publishableKey, accessToken }
}

function objectPath(location: ArtifactLocation, group: 'imports' | 'reports', id: string, extension: 'csv' | 'pdf') {
  return `${location.organizationId}/${location.projectId}/${group}/${id}.${extension}`
}

export function createSupabaseArtifactStore(configuration: ArtifactStoreConfiguration, clientFactory: ClientFactory = createClient) {
  const current = configured(configuration)
  const client = clientFactory(current.url, current.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${current.accessToken}` } },
  })
  const upload = async (bucketId: string, path: string, bytes: Buffer, contentType: string) => {
    const result = await client.storage.from(bucketId).upload(path, bytes, { contentType, upsert: false })
    if (result.error) throw new Error('Artifact storage upload failed.')
    return { bucketId, objectPath: path, byteSize: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  return {
    uploadCsv: (input: ArtifactLocation & { importJobId: string; bytes: Buffer; mediaType: string }) =>
      upload(ARTIFACT_BUCKETS.csv, objectPath(input, 'imports', input.importJobId, 'csv'), input.bytes, input.mediaType),
    uploadPdf: (input: ArtifactLocation & { reportId: string; bytes: Buffer }) =>
      upload(ARTIFACT_BUCKETS.pdf, objectPath(input, 'reports', input.reportId, 'pdf'), input.bytes, 'application/pdf'),
  }
}

export async function recordArtifactObject(database: Database, input: {
  id?: string
  organizationId: string
  projectId: string
  createdBy: string
  kind: 'csv' | 'pdf'
  bucketId: string
  objectPath: string
  mediaType: string
  byteSize: number
  sha256: string
  importJobId?: string
  reportId?: string
}) {
  const id = input.id || randomUUID()
  await database.query(
    `INSERT INTO artifact_objects
      (id, organization_id, project_id, created_by, kind, bucket_id, object_path, media_type, byte_size, sha256, import_job_id, report_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.organizationId, input.projectId, input.createdBy, input.kind, input.bucketId, input.objectPath,
      input.mediaType, input.byteSize, input.sha256, input.importJobId || null, input.reportId || null],
  )
  return id
}

export async function queueArtifactDeletion(database: Database, artifactObjectId: string) {
  await database.query(
    `INSERT INTO artifact_deletion_queue (id, artifact_object_id)
     VALUES ($1,$2) ON CONFLICT (artifact_object_id) DO NOTHING`,
    [randomUUID(), artifactObjectId],
  )
}
