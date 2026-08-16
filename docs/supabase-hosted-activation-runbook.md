# Supabase hosted activation runbook

This is the local readiness checklist for Voice Lab project `ugkubygaitrlwszygbno`. It contains variable names and placeholders only. It does not create users, change hosted Auth, write deployment configuration, or disclose credentials.

The hosted project has the reviewed migration chain through 007. Migration 006 defines the dedicated runtime login without embedding a password; migration 007 adds the verified first-login personal workspace/`Default project` boundary. Runtime activation still requires operator-managed credentials, approved Supabase Auth users, Auth/SMTP policy, deployment configuration, and live isolation tests.

## Deployment environment contract

| Variable | Where | Required value contract |
| --- | --- | --- |
| `DATABASE_URL` | Server only | PostgreSQL URL for a dedicated `LOGIN`, `NOBYPASSRLS` runtime role that inherits `voice_lab_api`; use the Supabase direct endpoint for an IPv6-capable persistent server or session pooler on an IPv4-only persistent server. URL-encode credentials. Never use the dashboard owner/admin connection. |
| `SUPABASE_URL` | Server only | HTTPS project URL for the same project as the browser value. |
| `SUPABASE_PUBLISHABLE_KEY` | Server only | Supabase publishable key paired with `SUPABASE_URL`; never a secret/service-role key. It validates bearer claims but grants no Voice Lab membership. |
| `VITE_SUPABASE_URL` | Browser build | Same HTTPS project URL. `VITE_` values are public and compiled into the browser bundle. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build | The corresponding publishable key only. Never place a secret/service-role key in any `VITE_` variable. |
| `VOICE_LAB_ADMIN_EMAILS` | Server only | Comma-separated, lower-case approved operator emails. Each must match both the verified Supabase claim email and an already provisioned `auth_users.email`; this allowlist grants only the private waitlist-monitoring capability, not membership. |

Set `NODE_ENV=production`, `GARAXE_DATABASE_SSL_MODE=verify-full`, and `VITE_LOCAL_QA_AUTH_ENABLED=false`. Set `GARAXE_DATABASE_CA_FILE` only when the deployment trust store needs the Supabase CA file. Demo remains on `GARAXE_DEMO_DB_DIR` PGlite and never reads `DATABASE_URL`.

The application Deployment reads its restricted runtime URL from `garaxe-voice-lab-secrets`. The migration Job uses the separate `garaxe-voice-lab-migration-secrets` credential; never point schema migration at the non-DDL runtime login.

## Redacted readiness check

Run this in the deployment environment before starting Voice Lab. It checks names, pairing, URL shape, browser/server project agreement, production safety flags, and the normalized admin allowlist without printing values or making network/database calls.

```sh
node <<'NODE'
const required = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VOICE_LAB_ADMIN_EMAILS',
  'NODE_ENV',
  'GARAXE_DATABASE_SSL_MODE',
  'VITE_LOCAL_QA_AUTH_ENABLED',
]
const errors = []
for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`${name}: missing`)
}
for (const name of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
  try {
    if (new URL(process.env[name]).protocol !== 'https:') errors.push(`${name}: must use HTTPS`)
  } catch {
    errors.push(`${name}: invalid URL`)
  }
}
try {
  const protocol = new URL(process.env.DATABASE_URL).protocol
  if (!['postgres:', 'postgresql:'].includes(protocol)) errors.push('DATABASE_URL: invalid PostgreSQL URL')
} catch {
  errors.push('DATABASE_URL: invalid PostgreSQL URL')
}
const normalizedUrl = (value = '') => value.replace(/\/+$/, '')
if (normalizedUrl(process.env.SUPABASE_URL) !== normalizedUrl(process.env.VITE_SUPABASE_URL)) {
  errors.push('SUPABASE_URL/VITE_SUPABASE_URL: project mismatch')
}
if (process.env.NODE_ENV !== 'production') errors.push('NODE_ENV: must be production')
if (process.env.GARAXE_DATABASE_SSL_MODE !== 'verify-full') errors.push('GARAXE_DATABASE_SSL_MODE: must be verify-full')
if (process.env.VITE_LOCAL_QA_AUTH_ENABLED !== 'false') errors.push('VITE_LOCAL_QA_AUTH_ENABLED: must be false')
if (Object.keys(process.env).some((name) => /^VITE_.*(SERVICE_ROLE|SECRET)/i.test(name))) {
  errors.push('VITE_*: secret/service-role variable name is forbidden')
}
const admins = (process.env.VOICE_LAB_ADMIN_EMAILS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
if (admins.some((email) => email !== email.toLowerCase())) errors.push('VOICE_LAB_ADMIN_EMAILS: use lower-case emails')
if (new Set(admins).size !== admins.length) errors.push('VOICE_LAB_ADMIN_EMAILS: duplicate email')
if (errors.length) {
  console.error(`Hosted activation environment: FAIL\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exit(1)
}
console.log(`Hosted activation environment: PASS (${required.length} required names present; values redacted)`)
NODE
```

Then run the local contract gates:

```sh
npx vitest run server/auth.test.ts server/database.test.ts server/postgresSsl.test.ts server/supabaseStorage.test.ts server/waitlistAdmin.test.ts server/waitlistAdminApi.test.ts server/migrations.test.ts --maxWorkers=1
npm run typecheck
npm run build
./scripts/check-docs-sync.sh
git diff --check
```

## Hosted activation sequence (not performed here)

1. Create a dedicated `LOGIN`, `NOBYPASSRLS` role that inherits `voice_lab_api`; test it before using its URL in `DATABASE_URL`.
2. Review hosted email/password, confirmation, redirect, recovery, rate-limit, and SMTP settings. Keep public signup disabled until explicitly approved.
3. Create or invite the approved first user through a server-only Supabase admin boundary, then provision its exact Auth UUID and email into `auth_users` and the intended organization membership. No automatic grants.
4. Set the server and browser deployment variables out of band, run the redacted readiness check, and build the browser with its `VITE_` pair.
5. Before traffic, prove first-login exact-once provisioning, repeat-login idempotence, cross-tenant denial, private Storage access/deletion, waitlist read denial, approved admin monitoring, logout/session revocation, backups, and rollback.

Use Supabase's documented direct connection for an IPv6-capable persistent backend or session pooler for an IPv4-only persistent backend. Transaction pooler mode is intended for temporary/serverless clients and does not support prepared statements.
