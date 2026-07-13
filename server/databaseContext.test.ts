// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database, DatabaseClient } from './database'
import { withDatabaseUser } from './database'

describe('transaction-scoped database identity', () => {
  it('sets the user locally before standalone queries and transaction work', async () => {
    const calls: Array<{ sql: string; parameters?: unknown[] }> = []
    const client: DatabaseClient = {
      query: async <Row>(sql: string, parameters?: unknown[]) => {
        calls.push({ sql, parameters })
        return { rows: [{ ok: true }] as Row[] }
      },
      exec: async (sql: string) => { calls.push({ sql }); return undefined },
    }
    const database: Database = {
      ...client,
      transaction: vi.fn(async (work) => work(client)),
    }
    const scoped = withDatabaseUser(database, '11111111-1111-4111-8111-111111111111')
    await scoped.query('SELECT protected FROM projects WHERE id = $1', ['project'])
    await scoped.transaction(async (transaction) => transaction.query('UPDATE projects SET name = $1', ['safe']))
    expect(calls).toEqual([
      { sql: `SELECT set_config('app.current_user_id', $1, true)`, parameters: ['11111111-1111-4111-8111-111111111111'] },
      { sql: 'SELECT protected FROM projects WHERE id = $1', parameters: ['project'] },
      { sql: `SELECT set_config('app.current_user_id', $1, true)`, parameters: ['11111111-1111-4111-8111-111111111111'] },
      { sql: 'UPDATE projects SET name = $1', parameters: ['safe'] },
    ])
    expect(database.transaction).toHaveBeenCalledTimes(2)
  })
})
