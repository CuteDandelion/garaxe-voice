import { PGlite } from '@electric-sql/pglite'
import { Pool, type PoolClient } from 'pg'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { schemaSql } from './schema'
import { authSchemaSql } from './auth'
import { googleOAuthSchemaSql } from './googleOAuth'
import { googleSyncSchemaSql } from './googleSync'
import { llmQueueSchemaSql } from './llmQueue'
import type { Database, DatabaseClient } from './database'

let databasePromise: Promise<Database> | undefined

type PoolLike = Pick<Pool, 'query' | 'connect'>

export function createManagedPostgresDatabase(pool: PoolLike): Database {
  const fromClient = (client: PoolClient): DatabaseClient => ({
    query: async <Row>(sql: string, parameters: unknown[] = []) => {
      const result = await client.query(sql, parameters)
      return { rows: result.rows as Row[] }
    },
    exec: (sql) => client.query(sql),
  })
  return {
    query: async <Row>(sql: string, parameters: unknown[] = []) => {
      const result = await pool.query(sql, parameters)
      return { rows: result.rows as Row[] }
    },
    exec: (sql) => pool.query(sql),
    transaction: async <Result>(work: (database: DatabaseClient) => Promise<Result>) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(fromClient(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}

function postgresDatabase(connectionString: string): Database {
  return createManagedPostgresDatabase(new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  }))
}

export function getDatabase() {
  if (!databasePromise) {
    if (process.env.DATABASE_URL) {
      const database = postgresDatabase(process.env.DATABASE_URL)
      databasePromise = database.exec(schemaSql).then(() => database.exec(authSchemaSql)).then(() => database.exec(googleOAuthSchemaSql)).then(() => database.exec(googleSyncSchemaSql)).then(() => database.exec(llmQueueSchemaSql)).then(() => database)
      return databasePromise
    }
    const dataDir = process.env.GARAXE_DB_DIR || './.local/pgdata'
    if (dataDir !== 'memory://' && !dataDir.includes('://')) {
      mkdirSync(dirname(resolve(dataDir)), { recursive: true })
    }
    databasePromise = PGlite.create(dataDir).then(async (database) => {
      await database.exec(schemaSql)
      await database.exec(authSchemaSql)
      await database.exec(googleOAuthSchemaSql)
      await database.exec(googleSyncSchemaSql)
      await database.exec(llmQueueSchemaSql)
      return database as unknown as Database
    })
  }
  return databasePromise
}

export async function resetDatabaseForTests() {
  const database = await getDatabase()
  await database.exec(`
    TRUNCATE TABLE auth_users, organizations, projects CASCADE;
  `)
}
