import { PGlite } from '@electric-sql/pglite'
import { Pool, type PoolClient } from 'pg'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { schemaSql } from './schema'
import { authSchemaSql } from './auth'
import { googleOAuthSchemaSql } from './googleOAuth'
import { googleSyncSchemaSql } from './googleSync'
import { llmQueueSchemaSql } from './llmQueue'
import { demoAdmissionSchemaSql, demoAnalysisSchemaSql } from './demoAnalysis'
import { artifactStorageSchemaSql } from './supabaseStorage'
import type { Database, DatabaseClient } from './database'
import { postgresSslConfig } from './postgresSsl'

let databasePromise: Promise<Database> | undefined
let demoDatabasePromise: Promise<Database> | undefined
let closeDatabaseConnection: (() => Promise<void>) | undefined
let closeDemoDatabaseConnection: (() => Promise<void>) | undefined

type PoolLike = Pick<Pool, 'query' | 'connect'>

export const baseSchemaStatements = [schemaSql, authSchemaSql, artifactStorageSchemaSql, googleOAuthSchemaSql, googleSyncSchemaSql, llmQueueSchemaSql, demoAnalysisSchemaSql]

async function initializeDatabase(database: Database): Promise<Database> {
  for (const statement of baseSchemaStatements) await database.exec(statement)
  await database.exec(demoAdmissionSchemaSql)
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

export function databaseTargets(environment: NodeJS.ProcessEnv = process.env) {
  const authenticatedDataDir = environment.GARAXE_DB_DIR || './.local/pgdata'
  return {
    authenticated: environment.DATABASE_URL
      ? { kind: 'postgres' as const, connectionString: environment.DATABASE_URL }
      : { kind: 'pglite' as const, dataDir: authenticatedDataDir },
    demo: {
      kind: 'pglite' as const,
      dataDir: environment.GARAXE_DEMO_DB_DIR || (authenticatedDataDir === 'memory://' ? 'memory://' : './.local/demo-pgdata'),
    },
  }
}

function createPGliteDatabase(dataDir: string, setClose: (close: () => Promise<void>) => void) {
  if (dataDir !== 'memory://' && !dataDir.includes('://')) mkdirSync(dirname(resolve(dataDir)), { recursive: true })
  return PGlite.create(dataDir).then(async (database) => {
    setClose(() => database.close())
    return initializeDatabase(database as unknown as Database)
  })
}

export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    const target = databaseTargets().authenticated
    if (target.kind === 'postgres') {
      const database = postgresDatabase(target.connectionString)
      databasePromise = Promise.resolve(database)
      return databasePromise
    }
    databasePromise = createPGliteDatabase(target.dataDir, (close) => { closeDatabaseConnection = close })
  }
  return databasePromise
}

export function getDemoDatabase(): Promise<Database> {
  if (!demoDatabasePromise) {
    const target = databaseTargets().demo
    demoDatabasePromise = createPGliteDatabase(target.dataDir, (close) => { closeDemoDatabaseConnection = close })
  }
  return demoDatabasePromise
}

export async function closeDatabase() {
  const closes = [closeDatabaseConnection, closeDemoDatabaseConnection].filter((close): close is () => Promise<void> => Boolean(close))
  closeDatabaseConnection = undefined
  closeDemoDatabaseConnection = undefined
  databasePromise = undefined
  demoDatabasePromise = undefined
  await Promise.all(closes.map((close) => close()))
}

export async function resetDatabaseForTests() {
  const database = await getDatabase()
  const databases = [database]
  if (demoDatabasePromise) databases.push(await demoDatabasePromise)
  await Promise.all(databases.map((target) => target.exec(`
      TRUNCATE TABLE waitlist_signups, auth_users, organizations, projects CASCADE;
    `)))
}
