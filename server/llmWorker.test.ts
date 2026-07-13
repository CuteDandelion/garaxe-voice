// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authSchemaSql } from './auth'
import type { Database } from './database'
import { DurableLlmQueue, llmQueueSchemaSql } from './llmQueue'
import { LlmProviderError, type LlmCompletion } from './llmProvider'
import { LlmWorkerRuntime } from './llmWorker'
import { schemaSql } from './schema'

let database: Database
let queue: DurableLlmQueue
let organizationId: string
let projectId: string
let runId: string
let now: Date

const completion = (content = '{"candidate":"accepted"}'): LlmCompletion => ({
  provider: 'opencode_go', model: 'economy', content, finishReason: 'stop', requestId: 'safe-request-id',
  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
})

async function enqueue(inputDigest = randomUUID().replaceAll('-', ''), options: { maxAttempts?: number; deadlineAt?: Date; reservationMicro?: number } = {}) {
  const created = await queue.enqueue({
    organizationId, projectId, analysisRunId: runId, kind: 'signal_enrichment',
    provider: 'opencode-go', model: 'economy', inputDigest,
    promptVersion: 'prompt-v1', schemaVersion: 'schema-v1', routingPolicy: 'economy-first-v1',
    estimatedInputTokens: 100, maxOutputTokens: 50, reservationMicro: options.reservationMicro ?? 1_000,
    maxAttempts: options.maxAttempts ?? 2, deadlineAt: options.deadlineAt,
  })
  await database.query(`UPDATE llm_jobs SET available_at=$2 WHERE id=$1`, [created.id, now.toISOString()])
  return created
}

const runtime = (provider: { complete: ReturnType<typeof vi.fn> } | null, overrides: Partial<ConstructorParameters<typeof LlmWorkerRuntime>[0]> = {}) => new LlmWorkerRuntime({
  queue, provider, providerName: 'opencode-go', model: 'economy', workerId: 'worker-1',
  resolveWork: async () => ({ model: 'economy', maxTokens: 50, json: true, messages: [{ role: 'user', content: 'governed minimal payload' }] }),
  acceptCandidate: (result) => JSON.parse(result.content) as unknown,
  calculateCostMicro: () => 250,
  clock: () => now,
  random: () => 0.5,
  ...overrides,
})

beforeEach(async () => {
  const pglite = new PGlite()
  await pglite.exec(schemaSql)
  await pglite.exec(authSchemaSql)
  await pglite.exec(llmQueueSchemaSql)
  database = pglite as unknown as Database
  queue = new DurableLlmQueue(database)
  organizationId = randomUUID(); projectId = randomUUID(); runId = randomUUID()
  await database.query(`INSERT INTO organizations(id,name) VALUES($1,'Org')`, [organizationId])
  await database.query(`INSERT INTO projects(id,name,primary_decision) VALUES($1,'Project','research')`, [projectId])
  await database.query(`INSERT INTO project_organizations(project_id,organization_id) VALUES($1,$2)`, [projectId, organizationId])
  await database.query(`INSERT INTO analysis_runs(id,project_id,objective,configuration,status,stage,pipeline_version) VALUES($1,$2,'full_voice_map','{}','completed','completed','test')`, [runId, projectId])
  for (const [scope, id] of [['global', 'global'], ['organization', organizationId], ['project', projectId], ['run', runId]] as const) {
    await queue.configureBudget(scope, id, 10_000)
  }
  now = new Date('2026-07-13T12:00:00Z')
  await queue.configureRateBucket({ provider: 'opencode-go', model: 'economy', requestCapacity: 20, requestsPerSecond: 10, tokenCapacity: 10_000, tokensPerSecond: 10_000, now })
  await queue.configureProviderHealth({ provider: 'opencode-go', model: 'economy', failureThreshold: 2, cooldownMs: 5_000 })
})

describe('LlmWorkerRuntime', () => {
  it('leases, calls, accepts a governed candidate, and reconciles usage exactly once', async () => {
    const created = await enqueue('a'.repeat(64))
    const provider = { complete: vi.fn(async () => completion()) }
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'completed', jobId: created.id })
    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'idle' })
    const job = await database.query<{ state: string; result: { candidate: string } }>(`SELECT state,result_payload AS result FROM llm_jobs WHERE id=$1`, [created.id])
    expect(job.rows[0]).toEqual({ state: 'succeeded', result: { candidate: 'accepted' } })
    const ledger = await database.query(`SELECT id FROM llm_budget_ledger WHERE job_id=$1 AND entry_type='reconciliation'`, [created.id])
    expect(ledger.rows).toHaveLength(4)
  })

  it('extends the lease while a long provider request is in flight', async () => {
    const created = await enqueue('9'.repeat(64))
    const heartbeat = vi.spyOn(queue, 'heartbeat')
    const provider = { complete: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 45))
      return completion()
    }) }
    expect(await runtime(provider, { leaseMs: 30 }).runOnce()).toMatchObject({ type: 'completed', jobId: created.id })
    expect(heartbeat).toHaveBeenCalled()
  })

  it('honors Retry-After and falls back after bounded retry exhaustion', async () => {
    const created = await enqueue('b'.repeat(64), { maxAttempts: 2 })
    const provider = { complete: vi.fn()
      .mockRejectedValueOnce(new LlmProviderError('RATE_LIMITED', 'safe', 4_000, 429))
      .mockRejectedValueOnce(new LlmProviderError('PROVIDER_UNAVAILABLE', 'safe')) }
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'retry', reason: 'RATE_LIMITED' })
    const waiting = await database.query<{ availableAt: string }>(`SELECT available_at AS "availableAt" FROM llm_jobs WHERE id=$1`, [created.id])
    expect(new Date(waiting.rows[0].availableAt).getTime()).toBe(now.getTime() + 4_000)
    now = new Date(now.getTime() + 4_000)
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'fallback', reason: 'RETRY_EXHAUSTED' })
    expect(await queue.getJobState(created.id)).toBe('fallback_completed')
  })

  it('opens the circuit at its threshold and permits only one half-open probe after cooldown', async () => {
    const provider = { complete: vi.fn(async () => { throw new LlmProviderError('PROVIDER_UNAVAILABLE', 'safe') }) }
    const first = await enqueue('c'.repeat(64), { maxAttempts: 1 })
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'fallback', jobId: first.id })
    const second = await enqueue('d'.repeat(64), { maxAttempts: 1 })
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'fallback', jobId: second.id })
    const third = await enqueue('e'.repeat(64))
    expect(await runtime(provider).runOnce()).toMatchObject({ type: 'fallback', reason: 'CIRCUIT_OPEN' })
    expect(provider.complete).toHaveBeenCalledTimes(2)

    now = new Date(now.getTime() + 5_000)
    const probeJob = await enqueue('f'.repeat(64))
    const success = { complete: vi.fn(async () => completion()) }
    expect(await runtime(success).runOnce()).toMatchObject({ type: 'completed', jobId: probeJob.id })
    const health = await database.query<{ state: string; failures: number; inflight: boolean }>(
      `SELECT circuit_state AS state,consecutive_failures AS failures,half_open_in_flight AS inflight FROM llm_provider_health WHERE provider='opencode-go' AND model='economy'`,
    )
    expect(health.rows[0]).toEqual({ state: 'closed', failures: 0, inflight: false })
  })

  it('uses deterministic fallback when provider, budget, or deadline makes enrichment unavailable', async () => {
    const disabled = await enqueue('1'.repeat(64))
    expect(await runtime(null).runOnce()).toMatchObject({ type: 'fallback', reason: 'PROVIDER_DISABLED' })
    expect(await queue.getJobState(disabled.id)).toBe('fallback_completed')

    await queue.configureBudget('run', runId, 300)
    const budget = await enqueue('2'.repeat(64))
    expect(budget.state).toBe('budget_wait')
    expect(await runtime({ complete: vi.fn() }).runOnce()).toMatchObject({ type: 'fallback', reason: 'BUDGET_EXHAUSTED' })
    expect(await queue.getJobState(budget.id)).toBe('fallback_completed')

    await queue.configureBudget('run', runId, 10_000)
    const expired = await enqueue('3'.repeat(64), { deadlineAt: new Date(now.getTime() - 1) })
    expect(await runtime({ complete: vi.fn() }).runOnce()).toMatchObject({ type: 'idle' })
    expect(await queue.getJobState(expired.id)).toBe('fallback_completed')
  })

  it('does not persist rejected raw completion content or emit it in operational events', async () => {
    const created = await enqueue('4'.repeat(64), { maxAttempts: 1 })
    const events: unknown[] = []
    const provider = { complete: vi.fn(async () => completion('private raw review content')) }
    const result = await runtime(provider, { onEvent: (event) => events.push(event) }).runOnce()
    expect(result).toMatchObject({ type: 'fallback', reason: 'WORK_REJECTED' })
    const row = await database.query<{ payload: unknown; error: string }>(`SELECT result_payload AS payload,last_error_code AS error FROM llm_jobs WHERE id=$1`, [created.id])
    expect(row.rows[0]).toEqual({ payload: null, error: 'WORK_REJECTED' })
    expect(JSON.stringify(events)).not.toContain('private raw review content')
  })
})
