// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { authSchemaSql } from './auth'
import { schemaSql } from './schema'

const modulePath = resolve(process.cwd(), 'server/supabaseStorage.ts')

async function storageModule() {
  expect(existsSync(modulePath), 'Supabase artifact storage adapter is missing').toBe(true)
  return import(modulePath)
}

describe('authenticated Supabase artifact storage', () => {
  it('uses the user bearer token and fixed private CSV/PDF object paths', async () => {
    const { createSupabaseArtifactStore } = await storageModule()
    const upload = vi.fn(async (_path: string, _bytes: Buffer, _options: { contentType: string; upsert: boolean }) => ({ data: { path: 'stored' }, error: null }))
    const from = vi.fn((_bucket: string) => ({ upload }))
    const createClient = vi.fn((_url: string, _key: string, _options: unknown) => ({ storage: { from } }))
    const store = createSupabaseArtifactStore({
      url: 'https://ugkubygaitrlwszygbno.supabase.co',
      publishableKey: 'sb_publishable_test',
      accessToken: 'user.jwt.token',
    }, createClient as never)
    const organizationId = randomUUID(), projectId = randomUUID(), importJobId = randomUUID(), reportId = randomUUID()

    await store.uploadCsv({ organizationId, projectId, importJobId, bytes: Buffer.from('review_id,review_text'), mediaType: 'text/csv' })
    await store.uploadPdf({ organizationId, projectId, reportId, bytes: Buffer.from('%PDF-test') })

    expect(createClient).toHaveBeenCalledWith(
      'https://ugkubygaitrlwszygbno.supabase.co',
      'sb_publishable_test',
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer user.jwt.token' } } }),
    )
    expect(from.mock.calls.map(([bucket]) => bucket)).toEqual(['voice-lab-uploads', 'voice-lab-reports'])
    expect(upload.mock.calls.map(([path]) => path)).toEqual([
      `${organizationId}/${projectId}/imports/${importJobId}.csv`,
      `${organizationId}/${projectId}/reports/${reportId}.pdf`,
    ])
    expect(upload.mock.calls.every(([, , options]) => options.upsert === false)).toBe(true)
  })

  it('records object metadata and queues deletion once', async () => {
    const { artifactStorageSchemaSql, recordArtifactObject, queueArtifactDeletion } = await storageModule()
    const database = new PGlite()
    await database.exec(schemaSql)
    await database.exec(authSchemaSql)
    await database.exec(artifactStorageSchemaSql)
    const projectId = randomUUID(), organizationId = randomUUID(), userId = randomUUID(), objectId = randomUUID()
    await database.query(`INSERT INTO projects (id,name,primary_decision) VALUES ($1,'Storage project','research')`, [projectId])
    await database.query(`INSERT INTO organizations (id,name) VALUES ($1,'Storage org')`, [organizationId])
    await database.query(`INSERT INTO auth_users (id,email,display_name) VALUES ($1,'storage@example.com','Storage user')`, [userId])
    await database.query('INSERT INTO project_organizations (project_id,organization_id) VALUES ($1,$2)', [projectId, organizationId])

    await recordArtifactObject(database, {
      id: objectId, organizationId, projectId, createdBy: userId, kind: 'csv', bucketId: 'voice-lab-uploads',
      objectPath: `${organizationId}/${projectId}/imports/${randomUUID()}.csv`, mediaType: 'text/csv', byteSize: 42, sha256: 'a'.repeat(64),
    })
    await queueArtifactDeletion(database, objectId)
    await queueArtifactDeletion(database, objectId)

    const objects = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM artifact_objects WHERE id = $1', [objectId])
    const queue = await database.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM artifact_deletion_queue WHERE artifact_object_id = $1', [objectId])
    expect(objects.rows[0].count).toBe(1)
    expect(queue.rows[0].count).toBe(1)
  })
})
