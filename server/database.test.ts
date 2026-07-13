// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createManagedPostgresDatabase } from './db'

function poolFixture() {
  const query = vi.fn(async (sql: string) => ({ rows: sql === 'SELECT 1' ? [{ value: 1 }] : [] }))
  const release = vi.fn()
  const client = { query, release }
  const pool = { query, connect: vi.fn(async () => client) }
  return { pool, query, release }
}

describe('managed PostgreSQL adapter', () => {
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
