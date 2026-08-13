import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'

const supabaseUrl = process.env.SUPABASE_URL
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const databaseUrl = process.env.DATABASE_URL
const apiUrl = process.env.VOICE_LAB_API_URL || 'http://127.0.0.1:3001'
if (!supabaseUrl || !publishableKey || !databaseUrl) throw new Error('Local Supabase environment is incomplete.')
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(supabaseUrl) || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(databaseUrl)) {
  throw new Error('This check only runs against local Docker Supabase.')
}

const email = `voice-lab-${Date.now()}@example.test`
const password = `Local-${randomBytes(18).toString('base64url')}!`
const supabase = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } })
const pool = new Pool({ connectionString: databaseUrl })

async function workspace(accessToken: string) {
  const response = await fetch(`${apiUrl}/api/auth/me`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`Voice Lab auth failed with ${response.status}.`)
  return (await response.json()).data
}

try {
  const anonymous = await fetch(`${apiUrl}/api/auth/me`)
  if (anonymous.status !== 401) throw new Error(`Unauthenticated request returned ${anonymous.status}.`)

  const firstLogin = await supabase.auth.signUp({ email, password })
  if (firstLogin.error || !firstLogin.data.session?.access_token) throw firstLogin.error || new Error('Local signup returned no session.')
  const first = await workspace(firstLogin.data.session.access_token)

  await supabase.auth.signOut()
  const secondLogin = await supabase.auth.signInWithPassword({ email, password })
  if (secondLogin.error || !secondLogin.data.session?.access_token) throw secondLogin.error || new Error('Local second login returned no session.')
  const second = await workspace(secondLogin.data.session.access_token)

  const result = await pool.query(`
    SELECT COUNT(DISTINCT u.id)::int AS profiles,
           COUNT(DISTINCT m.organization_id)::int AS memberships,
           COUNT(DISTINCT p.id)::int AS projects,
           MIN(o.name) AS workspace_name,
           MIN(p.name) AS project_name,
           MIN(m.role) AS role
    FROM auth_users u
    JOIN organization_memberships m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    JOIN project_organizations po ON po.organization_id = o.id
    JOIN projects p ON p.id = po.project_id
    WHERE u.email = $1
  `, [email])
  const row = result.rows[0]
  if (row.profiles !== 1 || row.memberships !== 1 || row.projects !== 1
    || row.workspace_name !== 'Personal workspace' || row.project_name !== 'Default project' || row.role !== 'owner') {
    throw new Error(`Unexpected local onboarding shape: ${JSON.stringify(row)}`)
  }
  if (first.user.id !== second.user.id || first.memberships.length !== 1 || second.memberships.length !== 1) {
    throw new Error('Second login did not reuse the first personal workspace.')
  }
  console.log('Local Supabase Auth: first login 1 workspace + 1 Default project; second login unchanged; unauthenticated request denied.')
} finally {
  await pool.end()
}
