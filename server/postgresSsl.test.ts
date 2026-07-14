import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { postgresSslConfig } from './postgresSsl'

describe('postgresSslConfig', () => {
  it('verifies certificates by default in production', () => {
    expect(postgresSslConfig({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true })
  })

  it('allows an explicit private-cluster plaintext connection', () => {
    expect(postgresSslConfig({ NODE_ENV: 'production', GARAXE_DATABASE_SSL_MODE: 'disable' })).toBeUndefined()
  })

  it('loads a configured certificate authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'garaxe-postgres-ca-'))
    const caFile = join(directory, 'ca.pem')
    try {
      writeFileSync(caFile, 'test-ca')
      expect(postgresSslConfig({ NODE_ENV: 'production', GARAXE_DATABASE_SSL_MODE: 'verify-full', GARAXE_DATABASE_CA_FILE: caFile }))
        .toEqual({ rejectUnauthorized: true, ca: 'test-ca' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous modes', () => {
    expect(() => postgresSslConfig({ NODE_ENV: 'production', GARAXE_DATABASE_SSL_MODE: 'require' })).toThrow(/verify-full/)
  })
})
