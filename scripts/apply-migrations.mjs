import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to apply managed PostgreSQL migrations.')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined })
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock($1)', [728341901])
  await client.query(`CREATE TABLE IF NOT EXISTS public.garaxe_schema_migrations (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  const directory = resolve('server/migrations')
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files) {
    const sql = await readFile(resolve(directory, name), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM public.garaxe_schema_migrations WHERE name = $1', [name])
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has changed.`)
      continue
    }
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO public.garaxe_schema_migrations (name, checksum) VALUES ($1,$2)', [name, checksum])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [728341901]).catch(() => undefined)
  client.release()
  await pool.end()
}
