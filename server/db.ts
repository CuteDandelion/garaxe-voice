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
import { postgresSslConfig } from './postgresSsl'

let databasePromise: Promise<Database> | undefined
let closeDatabaseConnection: (() => Promise<void>) | undefined

type PoolLike = Pick<Pool, 'query' | 'connect'>

export const baseSchemaStatements = [schemaSql, authSchemaSql, googleOAuthSchemaSql, googleSyncSchemaSql, llmQueueSchemaSql]

async function initializeDatabase(database: Database): Promise<Database> {
  for (const statement of baseSchemaStatements) await database.exec(statement)
  return database
}

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
  const pool = new Pool({
    connectionString,
    ssl: postgresSslConfig(),
  })
  closeDatabaseConnection = () => pool.end()
  return createManagedPostgresDatabase(pool)
}

export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    if (process.env.DATABASE_URL) {
      const database = postgresDatabase(process.env.DATABASE_URL)
      databasePromise = initializeDatabase(database)
      return databasePromise
    }
    const dataDir = process.env.GARAXE_DB_DIR || './.local/pgdata'
    if (dataDir !== 'memory://' && !dataDir.includes('://')) {
      mkdirSync(dirname(resolve(dataDir)), { recursive: true })
    }
    databasePromise = PGlite.create(dataDir).then(async (database) => {
      closeDatabaseConnection = () => database.close()
      return initializeDatabase(database as unknown as Database)
    })
  }
  return databasePromise
}

export async function closeDatabase() {
  const close = closeDatabaseConnection
  closeDatabaseConnection = undefined
  databasePromise = undefined
  await close?.()
}

export async function resetDatabaseForTests() {
  const database = await getDatabase()
  await database.exec(`
    TRUNCATE TABLE auth_users, organizations, projects CASCADE;
  `)
}
