// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { authSchemaSql } from './auth'
import { googleOAuthSchemaSql } from './googleOAuth'
import { googleSyncSchemaSql } from './googleSync'
import { llmQueueSchemaSql } from './llmQueue'
import { schemaSql } from './schema'

describe('managed tenant migration', () => {
  it('applies idempotently and forces RLS on every tenant-owned table', async () => {
    const database = new PGlite()
    await database.exec(schemaSql)
    await database.exec(authSchemaSql)
    await database.exec(googleOAuthSchemaSql)
    await database.exec(googleSyncSchemaSql)
    await database.exec(llmQueueSchemaSql)
    const migration = await readFile(resolve(process.cwd(), 'server/migrations/001_tenant_rls.sql'), 'utf8')
    await database.exec(migration)
    await database.exec(migration)
    const expected = [
      'projects', 'project_organizations', 'import_jobs', 'review_source_records', 'reviews',
      'analysis_runs', 'analysis_run_reviews', 'review_signals', 'themes', 'theme_evidence', 'voice_maps',
      'curation_sessions', 'curation_actions', 'reports', 'google_oauth_states',
      'google_business_connections', 'google_business_entities', 'google_sync_job_entities',
      'llm_jobs', 'llm_attempts', 'llm_budget_accounts', 'llm_budget_ledger',
    ]
    const rls = await database.query<{ tableName: string; enabled: boolean; forced: boolean }>(
      `SELECT relname AS "tableName", relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`, [expected],
    )
    expect(rls.rows).toHaveLength(expected.length)
    expect(rls.rows.every((row) => row.enabled && row.forced)).toBe(true)
    const policies = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_policies
       WHERE schemaname = 'public' AND policyname = 'tenant_isolation' AND tablename = ANY($1::text[])`, [expected],
    )
    expect(Number(policies.rows[0].count)).toBe(expected.length)
  })

  it('filters projects by the transaction-scoped user under a least-privilege role', async () => {
    const database = new PGlite()
    await database.exec(schemaSql)
    await database.exec(authSchemaSql)
    await database.exec(googleOAuthSchemaSql)
    await database.exec(googleSyncSchemaSql)
    await database.exec(llmQueueSchemaSql)
    const userA = randomUUID(), userB = randomUUID(), orgA = randomUUID(), orgB = randomUUID(), projectA = randomUUID(), projectB = randomUUID()
    await database.query(`INSERT INTO auth_users (id,email,display_name) VALUES ($1,'a@example.com','A'),($2,'b@example.com','B')`, [userA, userB])
    await database.query(`INSERT INTO organizations (id,name) VALUES ($1,'Org A'),($2,'Org B')`, [orgA, orgB])
    await database.query(`INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')`, [orgA, userA, orgB, userB])
    await database.query(`INSERT INTO projects (id,name,primary_decision) VALUES ($1,'A project','research'),($2,'B project','research')`, [projectA, projectB])
    await database.query(`INSERT INTO project_organizations (project_id,organization_id) VALUES ($1,$2),($3,$4)`, [projectA, orgA, projectB, orgB])
    const migration = await readFile(resolve(process.cwd(), 'server/migrations/001_tenant_rls.sql'), 'utf8')
    await database.exec(migration)
    await database.exec(`CREATE ROLE garaxe_rls_test NOLOGIN; GRANT USAGE ON SCHEMA public TO garaxe_rls_test; GRANT SELECT, INSERT, UPDATE, DELETE ON projects, project_organizations TO garaxe_rls_test; SET ROLE garaxe_rls_test;`)
    await database.query(`SELECT set_config('app.current_user_id',$1,false)`, [userA])
    const visible = await database.query<{ id: string }>('SELECT id FROM projects ORDER BY id')
    expect(visible.rows).toEqual([{ id: projectA }])
    const inserted = randomUUID()
    await database.query(`INSERT INTO projects (id,name,primary_decision) VALUES ($1,'New A project','research')`, [inserted])
    await database.query(`INSERT INTO project_organizations (project_id,organization_id) VALUES ($1,$2)`, [inserted, orgA])
    const afterInsert = await database.query<{ id: string }>('SELECT id FROM projects WHERE id = $1', [inserted])
    expect(afterInsert.rows).toEqual([{ id: inserted }])
    await database.exec('RESET ROLE')
  })
})
