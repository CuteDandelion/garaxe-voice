// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { authSchemaSql } from './auth'
import type { Database } from './database'
import { DurableLlmQueue, llmIdempotencyKey, llmQueueSchemaSql } from './llmQueue'
import { schemaSql } from './schema'

let database: Database
let queue: DurableLlmQueue
let organizationId: string
let projectId: string
let runId: string
let baseTime: number
const at = (offsetMs = 0) => new Date(baseTime + offsetMs)

async function fixture() {
  organizationId = randomUUID()
  projectId = randomUUID()
  runId = randomUUID()
  await database.query(`INSERT INTO organizations (id,name) VALUES ($1,'Test organization')`, [organizationId])
  await database.query(`INSERT INTO projects (id,name,primary_decision) VALUES ($1,'Test project','research')`, [projectId])
  await database.query(`INSERT INTO project_organizations (project_id,organization_id) VALUES ($1,$2)`, [projectId, organizationId])
  await database.query(
    `INSERT INTO analysis_runs (id,project_id,objective,configuration,status,stage,pipeline_version)
     VALUES ($1,$2,'full_voice_map','{}','completed','completed','test')`, [runId, projectId],
  )
  for (const [scopeType, scopeId] of [
    ['global', 'global'], ['organization', organizationId], ['project', projectId], ['run', runId],
  ] as const) await queue.configureBudget(scopeType, scopeId, 10_000)
  await queue.configureRateBucket({
    provider: 'opencode-go', model: 'economy', requestCapacity: 10, requestsPerSecond: 1,
    tokenCapacity: 10_000, tokensPerSecond: 1_000, now: at(),
  })
}

const job = () => ({
  organizationId, projectId, analysisRunId: runId, kind: 'signal_enrichment',
  provider: 'opencode-go', model: 'economy', inputDigest: 'a'.repeat(64),
  promptVersion: 'prompt-v1', schemaVersion: 'schema-v1', routingPolicy: 'economy-first-v1',
  estimatedInputTokens: 200, maxOutputTokens: 100, reservationMicro: 1_000, maxAttempts: 2,
})

async function secondTenant() {
  const secondOrganizationId = randomUUID()
  const secondProjectId = randomUUID()
  const secondRunId = randomUUID()
  await database.query(`INSERT INTO organizations (id,name) VALUES ($1,'Second organization')`, [secondOrganizationId])
  await database.query(`INSERT INTO projects (id,name,primary_decision) VALUES ($1,'Second project','research')`, [secondProjectId])
  await database.query(`INSERT INTO project_organizations (project_id,organization_id) VALUES ($1,$2)`, [secondProjectId, secondOrganizationId])
  await database.query(
    `INSERT INTO analysis_runs (id,project_id,objective,configuration,status,stage,pipeline_version)
     VALUES ($1,$2,'full_voice_map','{}','completed','completed','test')`, [secondRunId, secondProjectId],
  )
  for (const [scopeType, scopeId] of [
    ['organization', secondOrganizationId], ['project', secondProjectId], ['run', secondRunId],
  ] as const) await queue.configureBudget(scopeType, scopeId, 10_000)
  return {
    organizationId: secondOrganizationId,
    projectId: secondProjectId,
    analysisRunId: secondRunId,
  }
}

beforeEach(async () => {
  baseTime = Date.now() + 60_000
  const pglite = new PGlite()
  await pglite.exec(schemaSql)
  await pglite.exec(authSchemaSql)
  await pglite.exec(llmQueueSchemaSql)
  database = pglite as unknown as Database
  queue = new DurableLlmQueue(database)
  await fixture()
})

describe('DurableLlmQueue', () => {
  it('derives stable SHA-256 idempotency and atomically reserves every budget scope once', async () => {
    expect(llmIdempotencyKey(job())).toMatch(/^[a-f0-9]{64}$/)
    const first = await queue.enqueue(job())
    const duplicate = await queue.enqueue(job())
    expect(first).toMatchObject({ state: 'queued', created: true })
    expect(duplicate).toMatchObject({ id: first.id, state: 'queued', created: false })
    const accounts = await database.query<{ reserved: string }>(
      `SELECT reserved_micro::text AS reserved FROM llm_budget_accounts ORDER BY scope_type`,
    )
    expect(accounts.rows).toHaveLength(4)
    expect(accounts.rows.every((row) => row.reserved === '1000')).toBe(true)
    const ledger = await database.query(`SELECT id FROM llm_budget_ledger WHERE entry_type='reservation'`)
    expect(ledger.rows).toHaveLength(4)
  })

  it('dispatches an unmetered job without budget accounts while still consuming rate capacity', async () => {
    await database.query(`DELETE FROM llm_budget_accounts`)
    const created = await queue.enqueue({ ...job(), reservationMicro: 0 })
    expect(created).toMatchObject({ state: 'queued', created: true })
    expect((await database.query(`SELECT id FROM llm_budget_ledger`)).rows).toHaveLength(0)
    const lease = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000, now: at(),
    })
    expect(lease?.id).toBe(created.id)
    expect(await queue.complete(created.id, lease!.leaseToken, {
      result: { acceptedCandidateIds: ['candidate-1'] }, inputTokens: 180, outputTokens: 80,
      usageVerified: false, now: at(1_000),
    })).toBe(true)
    const bucket = await database.query<{ requests: number; tokens: number }>(
      `SELECT request_tokens AS requests,token_tokens AS tokens FROM llm_rate_buckets
       WHERE provider='opencode-go' AND model='economy'`,
    )
    expect(bucket.rows[0]).toEqual({ requests: 9, tokens: 9_700 })
    expect((await database.query(`SELECT id FROM llm_budget_ledger`)).rows).toHaveLength(0)
  })

  it('rejects a cross-tenant run and holds work when any hierarchical budget cannot reserve', async () => {
    await expect(queue.enqueue({ ...job(), organizationId: randomUUID() })).rejects.toThrow('LLM_TENANT_RUN_MISMATCH')
    await queue.configureBudget('run', runId, 500)
    const waiting = await queue.enqueue({ ...job(), inputDigest: 'b'.repeat(64) })
    expect(waiting.state).toBe('budget_wait')
    const row = await database.query<{ reserved: string }>(`SELECT reserved_micro::text AS reserved FROM llm_jobs WHERE id=$1`, [waiting.id])
    expect(row.rows[0].reserved).toBe('0')
    expect(await queue.retryBudgetWait(waiting.id)).toBe(false)
    await queue.configureBudget('run', runId, 10_000)
    expect(await queue.retryBudgetWait(waiting.id)).toBe(true)
  })

  it('leases with opaque ownership, heartbeats, reclaims expiry, and preserves one active attempt', async () => {
    const created = await queue.enqueue(job())
    const now = at()
    const lease = await queue.leaseNext({ provider: 'opencode-go', model: 'economy', workerId: 'worker-a', leaseMs: 1_000, now })
    expect(lease).toMatchObject({ id: created.id, attemptNumber: 1 })
    expect(await queue.heartbeat(created.id, 'wrong-token', 2_000, at(100))).toBe(false)
    expect(await queue.heartbeat(created.id, lease!.leaseToken, 2_000, at(100))).toBe(true)
    expect(await queue.markRunning(created.id, lease!.leaseToken, at(200))).toBe(true)
    const reclaimed = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-b', leaseMs: 1_000,
      now: at(3_000),
    })
    expect(reclaimed).toMatchObject({ id: created.id, attemptNumber: 2 })
    const attempts = await database.query<{ attempt: number; outcome: string }>(
      `SELECT attempt_number AS attempt,outcome FROM llm_attempts WHERE job_id=$1 ORDER BY started_at,attempt_number`, [created.id],
    )
    expect(attempts.rows).toEqual([
      { attempt: 1, outcome: 'leased' }, { attempt: 1, outcome: 'running' },
      { attempt: 1, outcome: 'reclaimed' }, { attempt: 2, outcome: 'leased' },
    ])
  })

  it('moves work to rate_wait without consuming partial quota', async () => {
    await queue.configureRateBucket({
      provider: 'opencode-go', model: 'economy', requestCapacity: 0, requestsPerSecond: 0,
      tokenCapacity: 0, tokensPerSecond: 0, now: at(),
    })
    const created = await queue.enqueue(job())
    expect(await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 1_000,
      now: at(),
    })).toBeNull()
    const state = await database.query<{ state: string; retryAfter: string }>(
      `SELECT state,retry_after AS "retryAfter" FROM llm_jobs WHERE id=$1`, [created.id],
    )
    expect(state.rows[0].state).toBe('rate_wait')
    expect(new Date(state.rows[0].retryAfter).getTime()).toBeGreaterThan(at().getTime())
  })

  it('atomically enforces global and provider/model in-flight caps before consuming quota', async () => {
    await queue.configureConcurrencyLimit({ scopeType: 'global', maxInFlight: 1 })
    await queue.configureConcurrencyLimit({
      scopeType: 'provider_model', provider: 'opencode-go', model: 'economy', maxInFlight: 1,
    })
    const first = await queue.enqueue(job())
    const second = await queue.enqueue({ ...job(), inputDigest: 'e'.repeat(64) })
    const now = at()
    const [leaseA, leaseB] = await Promise.all([
      queue.leaseNext({ provider: 'opencode-go', model: 'economy', workerId: 'worker-a', leaseMs: 10_000, now }),
      queue.leaseNext({ provider: 'opencode-go', model: 'economy', workerId: 'worker-b', leaseMs: 10_000, now }),
    ])
    const leases = [leaseA, leaseB].filter((lease) => lease !== null)
    expect(leases).toHaveLength(1)
    expect(leases[0]!.id).toBe(first.id)
    const bucket = await database.query<{ requests: number; tokens: number }>(
      `SELECT request_tokens AS requests,token_tokens AS tokens FROM llm_rate_buckets
       WHERE provider='opencode-go' AND model='economy'`,
    )
    expect(bucket.rows[0]).toEqual({ requests: 9, tokens: 9_700 })
    const waiting = await database.query<{ state: string; retryAfter: string; error: string }>(
      `SELECT state,retry_after AS "retryAfter",last_error_code AS error FROM llm_jobs WHERE id=$1`, [second.id],
    )
    expect(waiting.rows[0]).toMatchObject({ state: 'rate_wait', error: 'CONCURRENCY_GLOBAL' })
    expect(new Date(waiting.rows[0].retryAfter).getTime()).toBe(at(10_000).getTime())

    await queue.configureConcurrencyLimit({ scopeType: 'global', maxInFlight: 10 })
    const providerHeld = await queue.enqueue({ ...job(), inputDigest: '2'.repeat(64) })
    expect(await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-c', leaseMs: 10_000, now,
    })).toBeNull()
    const providerWaiting = await database.query<{ state: string; error: string }>(
      `SELECT state,last_error_code AS error FROM llm_jobs WHERE id=$1`, [providerHeld.id],
    )
    expect(providerWaiting.rows[0]).toEqual({ state: 'rate_wait', error: 'CONCURRENCY_PROVIDER_MODEL' })
    const unchanged = await database.query<{ requests: number; tokens: number }>(
      `SELECT request_tokens AS requests,token_tokens AS tokens FROM llm_rate_buckets
       WHERE provider='opencode-go' AND model='economy'`,
    )
    expect(unchanged.rows[0]).toEqual({ requests: 9, tokens: 9_700 })
  })

  it('skips a saturated organization fairly and leases another organization in the same transaction', async () => {
    const second = await secondTenant()
    await queue.configureConcurrencyLimit({ scopeType: 'global', maxInFlight: 10 })
    await queue.configureConcurrencyLimit({
      scopeType: 'provider_model', provider: 'opencode-go', model: 'economy', maxInFlight: 10,
    })
    await queue.configureConcurrencyLimit({ scopeType: 'organization', organizationId, maxInFlight: 1 })
    await queue.configureConcurrencyLimit({ scopeType: 'organization', organizationId: second.organizationId, maxInFlight: 1 })
    const firstOrgFirst = await queue.enqueue(job())
    const firstOrgSecond = await queue.enqueue({ ...job(), inputDigest: 'f'.repeat(64) })
    const secondOrgJob = await queue.enqueue({
      ...job(), ...second, inputDigest: '1'.repeat(64),
    })
    const now = at()
    const firstLease = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-a', leaseMs: 10_000, now,
    })
    expect(firstLease?.id).toBe(firstOrgFirst.id)
    expect(await queue.markRunning(firstLease!.id, firstLease!.leaseToken, now)).toBe(true)
    const secondLease = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-b', leaseMs: 10_000, now,
    })
    expect(secondLease).toMatchObject({ id: secondOrgJob.id, organizationId: second.organizationId })
    expect(await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-c', leaseMs: 10_000, now,
    })).toBeNull()
    const held = await database.query<{ state: string; error: string }>(
      `SELECT state,last_error_code AS error FROM llm_jobs WHERE id=$1`, [firstOrgSecond.id],
    )
    expect(held.rows[0]).toEqual({ state: 'rate_wait', error: 'CONCURRENCY_ORGANIZATION' })
  })

  it('does not count expired leases against a concurrency cap', async () => {
    await queue.configureConcurrencyLimit({ scopeType: 'global', maxInFlight: 1 })
    await queue.configureConcurrencyLimit({
      scopeType: 'provider_model', provider: 'opencode-go', model: 'economy', maxInFlight: 1,
    })
    const created = await queue.enqueue(job())
    const first = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-a', leaseMs: 1_000,
      now: at(),
    })
    expect(first?.id).toBe(created.id)
    const reclaimed = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker-b', leaseMs: 1_000,
      now: at(1_000),
    })
    expect(reclaimed).toMatchObject({ id: created.id, attemptNumber: 2 })
  })

  it('reconciles verified usage once and conservatively charges the reservation when usage is unverified', async () => {
    const first = await queue.enqueue(job())
    const lease = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000,
      now: at(),
    })
    expect(await queue.complete(first.id, lease!.leaseToken, {
      result: { acceptedCandidateIds: ['candidate-1'] }, inputTokens: 180, outputTokens: 80,
      actualMicro: 600, usageVerified: true, now: at(1_000),
    })).toBe(true)
    expect(await queue.complete(first.id, lease!.leaseToken, {
      result: {}, actualMicro: 600, usageVerified: true, now: at(2_000),
    })).toBe(false)
    const second = await queue.enqueue({ ...job(), inputDigest: 'c'.repeat(64) })
    const secondLease = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000,
      now: at(2_000),
    })
    await queue.complete(second.id, secondLease!.leaseToken, {
      result: {}, usageVerified: false, now: at(3_000),
    })
    const accounts = await database.query<{ reserved: string; spent: string }>(
      `SELECT reserved_micro::text AS reserved,spent_micro::text AS spent FROM llm_budget_accounts ORDER BY scope_type`,
    )
    expect(accounts.rows.every((row) => row.reserved === '0' && row.spent === '1600')).toBe(true)
    const jobRow = await database.query<{ serialized: string }>(
      `SELECT CONCAT_WS('|', input_digest, prompt_version, schema_version, routing_policy, result_payload::text) AS serialized
       FROM llm_jobs WHERE id=$1`, [first.id],
    )
    expect(jobRow.rows[0].serialized).not.toContain('review text')
  })

  it('honors retry metadata, dead-letters at the attempt limit, and releases all reservations', async () => {
    const created = await queue.enqueue(job())
    const first = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000,
      now: at(),
    })
    const retryAfter = at(15_000)
    await queue.fail(created.id, first!.leaseToken, { errorCode: 'PROVIDER_429', retryAfter, now: at(1_000) })
    expect(await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000,
      now: at(14_000),
    })).toBeNull()
    const second = await queue.leaseNext({
      provider: 'opencode-go', model: 'economy', workerId: 'worker', leaseMs: 10_000,
      now: retryAfter,
    })
    await queue.fail(created.id, second!.leaseToken, { errorCode: 'PROVIDER_503', now: at(16_000) })
    const row = await database.query<{ state: string; reserved: string }>(
      `SELECT state,reserved_micro::text AS reserved FROM llm_jobs WHERE id=$1`, [created.id],
    )
    expect(row.rows[0]).toEqual({ state: 'dead_lettered', reserved: '0' })
    const accounts = await database.query<{ reserved: string }>(`SELECT reserved_micro::text AS reserved FROM llm_budget_accounts`)
    expect(accounts.rows.every((account) => account.reserved === '0')).toBe(true)
  })

  it('can finish deterministically without provider work and releases the reservation', async () => {
    const created = await queue.enqueue(job())
    expect(await queue.completeFallback(created.id)).toBe(true)
    expect(await queue.completeFallback(created.id)).toBe(false)
    const row = await database.query<{ state: string; reserved: string }>(
      `SELECT state,reserved_micro::text AS reserved FROM llm_jobs WHERE id=$1`, [created.id],
    )
    expect(row.rows[0]).toEqual({ state: 'fallback_completed', reserved: '0' })
    const cancellable = await queue.enqueue({ ...job(), inputDigest: 'd'.repeat(64) })
    expect(await queue.cancel(cancellable.id)).toBe(true)
    expect(await queue.cancel(cancellable.id)).toBe(false)
    const cancelled = await database.query<{ state: string; reserved: string }>(
      `SELECT state,reserved_micro::text AS reserved FROM llm_jobs WHERE id=$1`, [cancellable.id],
    )
    expect(cancelled.rows[0]).toEqual({ state: 'cancelled', reserved: '0' })
  })
})
