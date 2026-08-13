// @vitest-environment node
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { authSchemaSql } from './auth'
import { googleOAuthSchemaSql } from './googleOAuth'
import { googleSyncSchemaSql } from './googleSync'
import { llmQueueSchemaSql } from './llmQueue'
import { schemaSql } from './schema'
import { baseSchemaStatements } from './db'

describe('managed tenant migration', () => {
  it('bootstraps a fresh Supabase-compatible database from versioned migrations only', async () => {
    const directory = resolve(process.cwd(), 'server/migrations')
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
    expect(files).toEqual([
      '000_base_schema.sql',
      '001_tenant_rls.sql',
      '002_analysis_interpretation_status.sql',
      '002_supabase_auth.sql',
      '003_supabase_storage.sql',
      '004_server_only_hardening.sql',
      '005_waitlist_admin_monitoring.sql',
      '006_runtime_login.sql',
      '007_first_login_workspace.sql',
    ])

    const base = await readFile(resolve(directory, files[0]), 'utf8')
    expect(base).toBe(baseSchemaStatements.join('\n'))

    const database = new PGlite()
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id UUID PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT NULL::UUID $$;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN NOT NULL DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
      );
      CREATE TABLE storage.objects (id UUID PRIMARY KEY, bucket_id TEXT NOT NULL, name TEXT NOT NULL);
    `)
    for (const name of files) await database.exec(await readFile(resolve(directory, name), 'utf8'))

    const tables = await database.query<{ tableName: string }>(`
      SELECT table_name AS "tableName" FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [[
      'analysis_runs', 'artifact_deletion_queue', 'artifact_objects', 'auth_users',
      'google_business_connections', 'llm_jobs', 'projects', 'waitlist_signups',
    ]])
    expect(tables.rows.map((row) => row.tableName)).toEqual([
      'analysis_runs', 'artifact_deletion_queue', 'artifact_objects', 'auth_users',
      'google_business_connections', 'llm_jobs', 'projects', 'waitlist_signups',
    ])

    const rls = await database.query<{ tableName: string; enabled: boolean; forced: boolean }>(`
      SELECT relname AS "tableName", relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname
    `, [['artifact_deletion_queue', 'artifact_objects', 'auth_users', 'projects']])
    expect(rls.rows).toHaveLength(4)
    expect(rls.rows.every((row) => row.enabled && row.forced)).toBe(true)

    const policies = await database.query<{ policyName: string }>(`
      SELECT DISTINCT policyname AS "policyName" FROM pg_policies
      WHERE policyname = ANY($1::text[]) ORDER BY policyname
    `, [[
      'artifact_deletion_queue_api_access', 'artifact_objects_api_access',
      'auth_user_self_read', 'tenant_isolation', 'voice_lab_storage_object_read',
    ]])
    expect(policies.rows.map((row) => row.policyName)).toEqual([
      'artifact_deletion_queue_api_access', 'artifact_objects_api_access',
      'auth_user_self_read', 'tenant_isolation', 'voice_lab_storage_object_read',
    ])

    const roles = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_roles WHERE rolname = 'voice_lab_api'`,
    )
    expect(roles.rows[0].count).toBe('1')
    const runtimeRole = await database.query<{ login: boolean; bypassRls: boolean; member: boolean }>(`
      SELECT r.rolcanlogin AS login, r.rolbypassrls AS "bypassRls",
        pg_has_role(r.oid, 'voice_lab_api', 'MEMBER') AS member
      FROM pg_roles r WHERE r.rolname = 'voice_lab_runtime'
    `)
    expect(runtimeRole.rows).toEqual([{ login: true, bypassRls: false, member: true }])
    const buckets = await database.query<{ id: string; public: boolean }>(
      `SELECT id, public FROM storage.buckets ORDER BY id`,
    )
    expect(buckets.rows).toEqual([
      { id: 'voice-lab-reports', public: false },
      { id: 'voice-lab-uploads', public: false },
    ])

    const serverOnlyTables = await database.query<{
      tableName: string; enabled: boolean; forced: boolean
      anonAccess: boolean; authenticatedAccess: boolean; apiAccess: boolean
    }>(`
      SELECT c.relname AS "tableName", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')) AS "anonAccess",
        (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'INSERT')
          OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE')) AS "authenticatedAccess",
        (has_table_privilege('voice_lab_api', c.oid, 'SELECT') AND has_table_privilege('voice_lab_api', c.oid, 'INSERT')
          AND has_table_privilege('voice_lab_api', c.oid, 'UPDATE') AND has_table_privilege('voice_lab_api', c.oid, 'DELETE')) AS "apiAccess"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname
    `, [[
      'auth_sessions', 'demo_analysis_sessions', 'llm_concurrency_limits',
      'llm_provider_health', 'llm_rate_buckets',
    ]])
    expect(serverOnlyTables.rows).toEqual([
      { tableName: 'auth_sessions', enabled: true, forced: true, anonAccess: false, authenticatedAccess: false, apiAccess: false },
      { tableName: 'demo_analysis_sessions', enabled: true, forced: true, anonAccess: false, authenticatedAccess: false, apiAccess: false },
      { tableName: 'llm_concurrency_limits', enabled: true, forced: true, anonAccess: false, authenticatedAccess: false, apiAccess: true },
      { tableName: 'llm_provider_health', enabled: true, forced: true, anonAccess: false, authenticatedAccess: false, apiAccess: true },
      { tableName: 'llm_rate_buckets', enabled: true, forced: true, anonAccess: false, authenticatedAccess: false, apiAccess: true },
    ])

    const serverPolicies = await database.query<{ tableName: string; roles: string[] }>(`
      SELECT tablename AS "tableName", roles FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'voice_lab_api_server_control'
      ORDER BY tablename
    `)
    expect(serverPolicies.rows).toEqual([
      { tableName: 'llm_concurrency_limits', roles: ['voice_lab_api'] },
      { tableName: 'llm_provider_health', roles: ['voice_lab_api'] },
      { tableName: 'llm_rate_buckets', roles: ['voice_lab_api'] },
    ])

    const waitlistAccess = await database.query<{
      anonRead: boolean; authenticatedRead: boolean; apiRead: boolean
    }>(`
      SELECT has_table_privilege('anon', 'public.waitlist_signups', 'SELECT') AS "anonRead",
        has_table_privilege('authenticated', 'public.waitlist_signups', 'SELECT') AS "authenticatedRead",
        has_table_privilege('voice_lab_api', 'public.waitlist_signups', 'SELECT') AS "apiRead"
    `)
    expect(waitlistAccess.rows).toEqual([{ anonRead: false, authenticatedRead: false, apiRead: true }])
    const waitlistPolicy = await database.query<{ roles: string[]; command: string }>(`
      SELECT roles, cmd AS command FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'waitlist_signups' AND policyname = 'waitlist_api_monitor_read'
    `)
    expect(waitlistPolicy.rows).toEqual([{ roles: ['voice_lab_api'], command: 'SELECT' }])

    const helperPrivileges = await database.query<{
      signature: string; anonExecute: boolean; authenticatedExecute: boolean; apiExecute: boolean
    }>(`
      SELECT p.oid::regprocedure::text AS signature,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS "anonExecute",
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
        has_function_privilege('voice_lab_api', p.oid, 'EXECUTE') AS "apiExecute"
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[]) ORDER BY signature
    `, [[
      'app_can_access_google_connection', 'app_can_access_import', 'app_can_access_llm_budget',
      'app_can_access_llm_job', 'app_can_access_org', 'app_can_access_project',
      'app_can_access_run', 'app_can_access_theme',
    ]])
    expect(helperPrivileges.rows).toEqual([
      'app_can_access_google_connection(uuid)', 'app_can_access_import(uuid)',
      'app_can_access_llm_budget(text,text)', 'app_can_access_llm_job(uuid)',
      'app_can_access_org(uuid)', 'app_can_access_project(uuid)',
      'app_can_access_run(uuid)', 'app_can_access_theme(text)',
    ].map((signature) => ({ signature, anonExecute: false, authenticatedExecute: false, apiExecute: true })))

    await database.exec('SET ROLE voice_lab_api')
    await database.exec(`
      INSERT INTO llm_rate_buckets
        (provider,model,request_capacity,request_tokens,requests_per_second,token_capacity,token_tokens,tokens_per_second,refilled_at)
        VALUES ('test','test',1,1,1,1,1,1,NOW());
      INSERT INTO llm_concurrency_limits (scope_type,scope_id,max_in_flight) VALUES ('global','global',1);
      INSERT INTO llm_provider_health (provider,model) VALUES ('test','test');
    `)
    const helperResult = await database.query<{ allowed: boolean }>(
      `SELECT public.app_can_access_org($1) AS allowed`, [randomUUID()],
    )
    expect(helperResult.rows).toEqual([{ allowed: false }])
    await database.exec('RESET ROLE')
  })

  it('allows only the verified runtime identity to provision its first personal workspace', async () => {
    const migration = await readFile(resolve(process.cwd(), 'server/migrations/007_first_login_workspace.sql'), 'utf8')
    expect(migration).toContain('CREATE POLICY auth_user_self_provision')
    expect(migration).toContain('id = public.app_current_user_id()')
    expect(migration).toContain('CREATE POLICY owner_membership_self_provision')
    expect(migration).toContain("user_id = public.app_current_user_id() AND role = 'owner'")
    expect(migration).toContain('GRANT INSERT ON public.auth_users, public.organizations, public.organization_memberships TO voice_lab_api')
    expect(migration).toContain('REVOKE INSERT ON public.auth_users, public.organizations, public.organization_memberships FROM anon, authenticated, PUBLIC')
  })

  it('defines private authenticated artifact buckets, metadata, deletion queue, and least-privilege policies', async () => {
    const migrationPath = resolve(process.cwd(), 'server/migrations/003_supabase_storage.sql')
    expect(existsSync(migrationPath), 'Supabase Storage migration 003 is missing').toBe(true)
    if (!existsSync(migrationPath)) return
    const migration = await readFile(migrationPath, 'utf8')
    expect(migration).toContain("VALUES ('voice-lab-uploads', 'voice-lab-uploads', false")
    expect(migration).toContain("VALUES ('voice-lab-reports', 'voice-lab-reports', false")
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.artifact_objects')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.artifact_deletion_queue')
    expect(migration).toContain('ALTER TABLE public.artifact_objects FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE public.artifact_deletion_queue FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY voice_lab_storage_object_read')
    expect(migration).toContain('CREATE POLICY voice_lab_storage_object_insert')
    expect(migration).toContain('TO authenticated')
    expect(migration).toContain('JOIN public.project_organizations project_scope')
    expect(migration).toContain("target_bucket_id = 'voice-lab-uploads' AND split_part(object_name, '/', 3) = 'imports'")
    expect(migration).toContain("target_bucket_id = 'voice-lab-reports' AND split_part(object_name, '/', 3) = 'reports'")
    expect(migration).toContain('REVOKE ALL ON public.artifact_objects, public.artifact_deletion_queue FROM anon, authenticated, PUBLIC')
    expect(migration).not.toMatch(/GRANT .*service_role/i)
  })

  it('keeps Supabase Auth and waitlist access server-only without granting workspace membership', async () => {
    const migrationPath = resolve(process.cwd(), 'server/migrations/002_supabase_auth.sql')
    expect(existsSync(migrationPath)).toBe(true)
    if (!existsSync(migrationPath)) return
    const migration = await readFile(migrationPath, 'utf8')
    expect(migration).not.toMatch(/^BEGIN;|^COMMIT;/m)
    expect(migration).toContain('REFERENCES auth.users(id) ON DELETE CASCADE')
    expect(migration).toContain('CREATE ROLE voice_lab_api NOLOGIN NOBYPASSRLS')
    expect(migration).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated')
    expect(migration).toContain('CREATE POLICY auth_user_self_read')
    expect(migration).toContain('id = public.app_current_user_id()')
    expect(migration).toContain('CREATE POLICY waitlist_api_insert')
    expect(migration).toContain("consent_version = 'voice-lab-waitlist-v1'")
    expect(migration).toContain('REVOKE SELECT, UPDATE, DELETE ON public.waitlist_signups FROM voice_lab_api')
    expect(migration).not.toMatch(/INSERT INTO public\.organization_memberships/i)
  })

  it('upgrades the curation action constraint for an existing local database', async () => {
    const database = new PGlite()
    await database.exec(schemaSql)
    await database.exec(`
      ALTER TABLE curation_actions DROP CONSTRAINT curation_actions_action_type_check;
      ALTER TABLE curation_actions ADD CONSTRAINT curation_actions_action_type_check CHECK (action_type IN (
        'approve_theme', 'reject_theme', 'edit_theme', 'pin_evidence', 'exclude_evidence',
        'merge_themes', 'split_theme', 'mark_ready'
      ));
    `)

    await database.exec(schemaSql)

    const constraint = await database.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'curation_actions_action_type_check'
    `)
    expect(constraint.rows[0].definition).toContain('create_custom_theme')
  })

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
