import { readFileSync } from 'node:fs'
import type { PoolConfig } from 'pg'

type Environment = Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'GARAXE_DATABASE_SSL_MODE' | 'GARAXE_DATABASE_CA_FILE'>>

export function postgresSslConfig(environment: Environment = process.env): PoolConfig['ssl'] {
  const mode = environment.GARAXE_DATABASE_SSL_MODE?.trim() || (environment.NODE_ENV === 'production' ? 'verify-full' : 'disable')
  if (mode === 'disable') return undefined
  if (mode !== 'verify-full') {
    throw new Error('GARAXE_DATABASE_SSL_MODE must be either "verify-full" or "disable".')
  }

  const caFile = environment.GARAXE_DATABASE_CA_FILE?.trim()
  return {
    rejectUnauthorized: true,
    ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}),
  }
}
