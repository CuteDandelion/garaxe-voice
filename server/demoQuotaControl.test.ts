// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handleRequest } from './app'
import { getDemoDatabase, resetDatabaseForTests } from './db'
import { appendDemoAnalysisSessionCsv, createDemoAnalysisSession } from './demoAnalysis'
import { createDemoQuotaTestControl } from './testing/demoQuotaControl'
import { detectMapping, parseCsv, rowsToCsv } from '../src/lib/csv'

const enabledEnvironment = {
  GARAXE_LLM_ENRICHMENT_ENABLED: 'true',
  OPENCODE_GO_API_KEY: 'test-only-opencode-key',
  OPENCODE_GO_DEFAULT_MODEL: 'test-model',
  GARAXE_LLM_REQUEST_CAPACITY: '4',
  GARAXE_LLM_REQUESTS_PER_SECOND: '4',
  GARAXE_LLM_TOKEN_CAPACITY: '4000',
  GARAXE_LLM_TOKENS_PER_SECOND: '4000',
  GARAXE_LLM_GLOBAL_CONCURRENCY: '1',
  GARAXE_LLM_PROVIDER_CONCURRENCY: '1',
  GARAXE_LLM_ORGANIZATION_CONCURRENCY: '1',
  GARAXE_LLM_MAX_OUTPUT_TOKENS: '1200',
  GARAXE_LLM_DEADLINE_MS: '30000',
} as NodeJS.ProcessEnv

function csv(start: number, count: number) {
  const rawCsv = rowsToCsv([['review_id', 'source', 'review_text'], ...Array.from({ length: count }, (_, index) => [
    `quota-${start + index}`, 'Local quota fixture', `Unique feedback ${start + index} has enough detail for quota verification.`,
  ])])
  return { fileName: `quota-${start}-${count}.csv`, rawCsv, mapping: detectMapping(parseCsv(rawCsv).headers) }
}

describe('local Demo quota clock control', () => {
  let server: Server
  let baseUrl = ''
  const startedAt = new Date('2099-08-14T08:00:00.000Z')
  const control = createDemoQuotaTestControl(startedAt)

  beforeAll(async () => {
    process.env.GARAXE_DB_DIR = 'memory://'
    server = createServer((request, response) => void handleRequest(request, response, { demoQuotaControl: control }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Quota test server did not start.')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  beforeEach(async () => {
    control.reset(startedAt)
    await resetDatabaseForTests()
  })

  async function fillAllowance() {
    const database = await getDemoDatabase()
    const first = await createDemoAnalysisSession(database, { ...csv(1, 10), clientKey: 'browser-fixture' }, enabledEnvironment, startedAt)
    await database.query("UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1", [first.analysisRunId])
    const filled = await appendDemoAnalysisSessionCsv(database, first.token, csv(11, 40), enabledEnvironment, new Date('2099-08-14T09:00:00.000Z'))
    await database.query("UPDATE analysis_runs SET status = 'completed', stage = 'completed' WHERE id = $1", [filled.analysisRunId])
    return first
  }

  afterAll(async () => {
    delete process.env.GARAXE_DB_DIR
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('advances the cooldown only through the injected local control', async () => {
    const first = await fillAllowance()

    const before = await fetch(`${baseUrl}/api/demo/analysis-runs/${first.token}`).then((response) => response.json())
    expect(before.data.quota).toMatchObject({ remaining: 0, freshDemoAvailable: false })

    const advanced = await fetch(`${baseUrl}/api/_test/demo-quota-clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voice-lab-test-control': control.token },
      body: JSON.stringify({ advanceMs: 9 * 60 * 60 * 1_000 }),
    })
    expect(advanced.status).toBe(200)
    const after = await fetch(`${baseUrl}/api/demo/analysis-runs/${first.token}`).then((response) => response.json())
    expect(after.data.quota).toEqual({ remaining: 0, resetAt: null, freshDemoAvailable: true })
  })

  it('never exposes or honors the test clock in production', async () => {
    const first = await fillAllowance()
    control.advance(9 * 60 * 60 * 1_000)
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const response = await fetch(`${baseUrl}/api/_test/demo-quota-clock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-voice-lab-test-control': control.token },
        body: JSON.stringify({ advanceMs: 9 * 60 * 60 * 1_000 }),
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
      const status = await fetch(`${baseUrl}/api/demo/analysis-runs/${first.token}`).then((result) => result.json())
      expect(status.data.quota).toMatchObject({ remaining: 0, freshDemoAvailable: false })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })
})
