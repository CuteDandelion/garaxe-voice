// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { closeDatabase, createManagedPostgresDatabase, databaseTargets, getDatabase, getDemoDatabase } from './db'

function poolFixture() {
  const query = vi.fn(async (sql: string) => ({ rows: sql === 'SELECT 1' ? [{ value: 1 }] : [] }))
  const release = vi.fn()
  const client = { query, release }
  const pool = { query, connect: vi.fn(async () => client) }
  return { pool, query, release }
}

describe('managed PostgreSQL adapter', () => {
  it('leaves schema changes to managed migrations for authenticated PostgreSQL', async () => {
    const previous = {
      databaseUrl: process.env.DATABASE_URL,
      sslMode: process.env.GARAXE_DATABASE_SSL_MODE,
    }
    process.env.DATABASE_URL = 'postgresql://voice_lab_api:unused@127.0.0.1:1/postgres'
    process.env.GARAXE_DATABASE_SSL_MODE = 'disable'
    const query = vi.spyOn(Pool.prototype, 'query').mockRejectedValue(new Error('runtime schema mutation attempted') as never)
    await closeDatabase()
    try {
      await expect(getDatabase()).resolves.toBeDefined()
      expect(query).not.toHaveBeenCalled()
    } finally {
      await closeDatabase()
      query.mockRestore()
      if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl
      if (previous.sslMode === undefined) delete process.env.GARAXE_DATABASE_SSL_MODE; else process.env.GARAXE_DATABASE_SSL_MODE = previous.sslMode
    }
  })

  it('routes authenticated persistence to DATABASE_URL while keeping Demo on PGlite', () => {
    expect(databaseTargets({
      DATABASE_URL: 'postgresql://voice-lab.example/app',
      GARAXE_DB_DIR: '/ignored/authenticated',
      GARAXE_DEMO_DB_DIR: 'memory://',
    })).toEqual({
      authenticated: { kind: 'postgres', connectionString: 'postgresql://voice-lab.example/app' },
      demo: { kind: 'pglite', dataDir: 'memory://' },
    })
  })

  it('keeps authenticated and Demo records in distinct PGlite handles', async () => {
    const previous = { databaseUrl: process.env.DATABASE_URL, dataDir: process.env.GARAXE_DB_DIR, demoDir: process.env.GARAXE_DEMO_DB_DIR }
    delete process.env.DATABASE_URL
    process.env.GARAXE_DB_DIR = 'memory://'
    process.env.GARAXE_DEMO_DB_DIR = 'memory://'
    await closeDatabase()
    try {
      const authenticated = await getDatabase()
      const demo = await getDemoDatabase()
      await authenticated.query(
        `INSERT INTO projects (id, name, primary_decision) VALUES ('11111111-1111-4111-8111-111111111111', 'Authenticated', 'research')`,
      )
      const demoProjects = await demo.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM projects')
      expect(demoProjects.rows[0].count).toBe(0)
    } finally {
      await closeDatabase()
      if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl
      if (previous.dataDir === undefined) delete process.env.GARAXE_DB_DIR; else process.env.GARAXE_DB_DIR = previous.dataDir
      if (previous.demoDir === undefined) delete process.env.GARAXE_DEMO_DB_DIR; else process.env.GARAXE_DEMO_DB_DIR = previous.demoDir
    }
  }, 30_000)

  it('uses the pool for ordinary parameterized queries', async () => {
    const fixture = poolFixture()
    const database = createManagedPostgresDatabase(fixture.pool as never)
    await expect(database.query<{ value: number }>('SELECT 1', ['safe'])).resolves.toEqual({ rows: [{ value: 1 }] })
    expect(fixture.query).toHaveBeenCalledWith('SELECT 1', ['safe'])
  })

  it('commits successful work and rolls back failed work', async () => {
    const success = poolFixture()
    const database = createManagedPostgresDatabase(success.pool as never)
    await database.transaction(async (transaction) => transaction.query('INSERT SAFE', ['value']))
    expect(success.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'INSERT SAFE', 'COMMIT'])
    expect(success.release).toHaveBeenCalledOnce()

    const failure = poolFixture()
    failure.query.mockImplementation(async (sql: string) => {
      if (sql === 'INSERT FAIL') throw new Error('failed')
      return { rows: [] }
    })
    const failingDatabase = createManagedPostgresDatabase(failure.pool as never)
    await expect(failingDatabase.transaction(async (transaction) => transaction.query('INSERT FAIL'))).rejects.toThrow('failed')
    expect(failure.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'INSERT FAIL', 'ROLLBACK'])
    expect(failure.release).toHaveBeenCalledOnce()
  })
})
