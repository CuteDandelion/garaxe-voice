import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Database, DatabaseClient } from './database'

export const llmQueueSchemaSql = `
CREATE TABLE IF NOT EXISTS llm_jobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  routing_policy TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'queued','budget_wait','rate_wait','leased','running','succeeded','retry_wait',
    'dead_lettered','cancelled','fallback_completed'
  )),
  priority INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens >= 0),
  requested_reservation_micro BIGINT NOT NULL CHECK (requested_reservation_micro >= 0),
  reserved_micro BIGINT NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_token_hash TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_leased_at TIMESTAMPTZ,
  retry_after TIMESTAMPTZ,
  last_error_code TEXT,
  result_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE llm_jobs ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS llm_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES llm_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('leased','running','succeeded','retry','failed','reclaimed')),
  error_code TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  charged_micro BIGINT CHECK (charged_micro IS NULL OR charged_micro >= 0),
  usage_verified BOOLEAN,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS llm_budget_accounts (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','organization','project','run')),
  scope_id TEXT NOT NULL,
  limit_micro BIGINT NOT NULL CHECK (limit_micro >= 0),
  reserved_micro BIGINT NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  spent_micro BIGINT NOT NULL DEFAULT 0 CHECK (spent_micro >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(scope_type, scope_id),
  CHECK (reserved_micro + spent_micro <= limit_micro)
);

CREATE TABLE IF NOT EXISTS llm_budget_ledger (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES llm_jobs(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','organization','project','run')),
  scope_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('reservation','reconciliation','release')),
  reserved_delta_micro BIGINT NOT NULL,
  spent_delta_micro BIGINT NOT NULL,
  usage_verified BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, scope_type, scope_id, entry_type)
);

CREATE TABLE IF NOT EXISTS llm_rate_buckets (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_capacity BIGINT NOT NULL CHECK (request_capacity >= 0),
  request_tokens DOUBLE PRECISION NOT NULL CHECK (request_tokens >= 0),
  requests_per_second DOUBLE PRECISION NOT NULL CHECK (requests_per_second >= 0),
  token_capacity BIGINT NOT NULL CHECK (token_capacity >= 0),
  token_tokens DOUBLE PRECISION NOT NULL CHECK (token_tokens >= 0),
  tokens_per_second DOUBLE PRECISION NOT NULL CHECK (tokens_per_second >= 0),
  refilled_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider, model)
);

CREATE TABLE IF NOT EXISTS llm_concurrency_limits (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','provider_model','organization')),
  scope_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  max_in_flight INTEGER NOT NULL CHECK (max_in_flight >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(scope_type, scope_id),
  CHECK (
    (scope_type = 'global' AND scope_id = 'global' AND provider IS NULL AND model IS NULL AND organization_id IS NULL)
    OR (scope_type = 'provider_model' AND provider IS NOT NULL AND model IS NOT NULL AND organization_id IS NULL)
    OR (scope_type = 'organization' AND provider IS NULL AND model IS NULL AND organization_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS llm_provider_health (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold > 0),
  cooldown_ms INTEGER NOT NULL DEFAULT 60000 CHECK (cooldown_ms > 0),
  half_open_in_flight BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at TIMESTAMPTZ,
  next_probe_at TIMESTAMPTZ,
  last_outcome TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider, model)
);

CREATE INDEX IF NOT EXISTS llm_jobs_dispatch_idx
  ON llm_jobs(provider, model, state, available_at, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS llm_jobs_org_dispatch_idx
  ON llm_jobs(organization_id, last_leased_at, created_at);
CREATE INDEX IF NOT EXISTS llm_jobs_lease_idx ON llm_jobs(state, lease_expires_at);
CREATE INDEX IF NOT EXISTS llm_jobs_active_provider_idx
  ON llm_jobs(provider, model, lease_expires_at) WHERE state IN ('leased','running');
CREATE INDEX IF NOT EXISTS llm_jobs_active_org_idx
  ON llm_jobs(organization_id, lease_expires_at) WHERE state IN ('leased','running');
CREATE INDEX IF NOT EXISTS llm_attempts_job_idx ON llm_attempts(job_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS llm_budget_ledger_job_idx ON llm_budget_ledger(job_id, created_at);
`

export type LlmJobState = 'queued' | 'budget_wait' | 'rate_wait' | 'leased' | 'running' |
  'succeeded' | 'retry_wait' | 'dead_lettered' | 'cancelled' | 'fallback_completed'
export type BudgetScope = 'global' | 'organization' | 'project' | 'run'
export type ConcurrencyScope = 'global' | 'provider_model' | 'organization'

export type ConfigureConcurrencyLimit =
  | { scopeType: 'global'; maxInFlight: number }
  | { scopeType: 'provider_model'; provider: string; model: string; maxInFlight: number }
  | { scopeType: 'organization'; organizationId: string; maxInFlight: number }

export type EnqueueLlmJob = {
  organizationId: string
  projectId: string
  analysisRunId: string
  kind: string
  provider: string
  model: string
  inputDigest: string
  promptVersion: string
  schemaVersion: string
  routingPolicy: string
  estimatedInputTokens: number
  maxOutputTokens: number
  reservationMicro: number
  priority?: number
  maxAttempts?: number
  deadlineAt?: Date
}

export type LeasedLlmJob = {
  id: string
  organizationId: string
  projectId: string
  analysisRunId: string
  kind: string
  provider: string
  model: string
  promptVersion: string
  schemaVersion: string
  routingPolicy: string
  attemptNumber: number
  leaseToken: string
  leaseExpiresAt: string
  deadlineAt: string | null
}

const budgetScopes = (job: Pick<EnqueueLlmJob, 'organizationId' | 'projectId' | 'analysisRunId'>) => [
  { type: 'global' as const, id: 'global' },
  { type: 'organization' as const, id: job.organizationId },
  { type: 'project' as const, id: job.projectId },
  { type: 'run' as const, id: job.analysisRunId },
]

function positiveSafeInteger(value: number, field: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`INVALID_${field.toUpperCase()}`)
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function providerModelScopeId(provider: string, model: string) {
  return hash(JSON.stringify([provider, model]))
}

const concurrencyRetryAt = (now: Date, earliestExpiry: string | null) => {
  const expiry = earliestExpiry ? new Date(earliestExpiry).getTime() : Number.NaN
  return new Date(Number.isFinite(expiry) && expiry > now.getTime() ? expiry : now.getTime() + 1_000).toISOString()
}

export function llmIdempotencyKey(input: Pick<EnqueueLlmJob,
  'organizationId' | 'analysisRunId' | 'kind' | 'inputDigest' | 'promptVersion' | 'schemaVersion' | 'routingPolicy'>) {
  return hash(JSON.stringify([
    input.organizationId, input.analysisRunId, input.kind, input.inputDigest,
    input.promptVersion, input.schemaVersion, input.routingPolicy,
  ]))
}

async function assertTenantRun(client: DatabaseClient, input: Pick<EnqueueLlmJob, 'organizationId' | 'projectId' | 'analysisRunId'>) {
  const found = await client.query(
    `SELECT 1 FROM analysis_runs r
     JOIN project_organizations po ON po.project_id = r.project_id
     WHERE r.id = $1 AND r.project_id = $2 AND po.organization_id = $3`,
    [input.analysisRunId, input.projectId, input.organizationId],
  )
  if (!found.rows[0]) throw new Error('LLM_TENANT_RUN_MISMATCH')
}

async function releaseReservation(client: DatabaseClient, job: {
  id: string; organizationId: string; projectId: string; analysisRunId: string; reservedMicro: number
}) {
  if (job.reservedMicro === 0) return
  for (const scope of budgetScopes(job)) {
    await client.query(
      `UPDATE llm_budget_accounts SET reserved_micro = reserved_micro - $3, updated_at = NOW()
       WHERE scope_type = $1 AND scope_id = $2 AND reserved_micro >= $3`,
      [scope.type, scope.id, job.reservedMicro],
    )
    await client.query(
      `INSERT INTO llm_budget_ledger
       (id, job_id, scope_type, scope_id, entry_type, reserved_delta_micro, spent_delta_micro)
       VALUES ($1,$2,$3,$4,'release',$5,0) ON CONFLICT DO NOTHING`,
      [randomUUID(), job.id, scope.type, scope.id, -job.reservedMicro],
    )
  }
}

export class DurableLlmQueue {
  constructor(private readonly database: Database) {}

  async configureBudget(scopeType: BudgetScope, scopeId: string, limitMicro: number) {
    positiveSafeInteger(limitMicro, 'limit_micro')
    if (!scopeId.trim()) throw new Error('INVALID_SCOPE_ID')
    await this.database.query(
      `INSERT INTO llm_budget_accounts (scope_type, scope_id, limit_micro)
       VALUES ($1,$2,$3)
       ON CONFLICT (scope_type, scope_id) DO UPDATE SET limit_micro = EXCLUDED.limit_micro, updated_at = NOW()
       WHERE llm_budget_accounts.reserved_micro + llm_budget_accounts.spent_micro <= EXCLUDED.limit_micro`,
      [scopeType, scopeId, limitMicro],
    )
  }

  async configureRateBucket(input: {
    provider: string; model: string; requestCapacity: number; requestsPerSecond: number
    tokenCapacity: number; tokensPerSecond: number; now?: Date
  }) {
    for (const [field, value] of [['requestCapacity', input.requestCapacity], ['tokenCapacity', input.tokenCapacity]] as const) {
      positiveSafeInteger(value, field)
    }
    if (![input.requestsPerSecond, input.tokensPerSecond].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error('INVALID_RATE_REFILL')
    }
    const now = (input.now || new Date()).toISOString()
    await this.database.query(
      `INSERT INTO llm_rate_buckets
       (provider,model,request_capacity,request_tokens,requests_per_second,token_capacity,token_tokens,tokens_per_second,refilled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (provider,model) DO UPDATE SET
         request_capacity=EXCLUDED.request_capacity,
         request_tokens=LEAST(llm_rate_buckets.request_tokens, EXCLUDED.request_capacity),
         requests_per_second=EXCLUDED.requests_per_second,
         token_capacity=EXCLUDED.token_capacity,
         token_tokens=LEAST(llm_rate_buckets.token_tokens, EXCLUDED.token_capacity),
         tokens_per_second=EXCLUDED.tokens_per_second,
         refilled_at=EXCLUDED.refilled_at, updated_at=NOW()`,
      [input.provider, input.model, input.requestCapacity, input.requestCapacity, input.requestsPerSecond,
        input.tokenCapacity, input.tokenCapacity, input.tokensPerSecond, now],
    )
  }

  async configureConcurrencyLimit(input: ConfigureConcurrencyLimit) {
    positiveSafeInteger(input.maxInFlight, 'max_in_flight')
    const scopeId = input.scopeType === 'global'
      ? 'global'
      : input.scopeType === 'provider_model'
        ? providerModelScopeId(input.provider, input.model)
        : input.organizationId
    if (input.scopeType === 'provider_model' && (!input.provider.trim() || !input.model.trim())) {
      throw new Error('INVALID_CONCURRENCY_PROVIDER_MODEL')
    }
    await this.database.query(
      `INSERT INTO llm_concurrency_limits
       (scope_type,scope_id,provider,model,organization_id,max_in_flight)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (scope_type,scope_id) DO UPDATE SET
         provider=EXCLUDED.provider,model=EXCLUDED.model,organization_id=EXCLUDED.organization_id,
         max_in_flight=EXCLUDED.max_in_flight,updated_at=NOW()`,
      [input.scopeType, scopeId,
        input.scopeType === 'provider_model' ? input.provider : null,
        input.scopeType === 'provider_model' ? input.model : null,
        input.scopeType === 'organization' ? input.organizationId : null,
        input.maxInFlight],
    )
  }

  async enqueue(input: EnqueueLlmJob) {
    positiveSafeInteger(input.estimatedInputTokens, 'estimated_input_tokens')
    positiveSafeInteger(input.maxOutputTokens, 'max_output_tokens')
    positiveSafeInteger(input.reservationMicro, 'reservation_micro')
    positiveSafeInteger(input.maxAttempts ?? 3, 'max_attempts', false)
    const idempotencyKey = llmIdempotencyKey(input)
    return this.database.transaction(async (client) => {
      await assertTenantRun(client, input)
      const existing = await client.query<{ id: string; state: LlmJobState }>(
        `SELECT id,state FROM llm_jobs WHERE organization_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [input.organizationId, idempotencyKey],
      )
      if (existing.rows[0]) return { ...existing.rows[0], created: false }

      const accounts = [] as Array<{ type: BudgetScope; id: string }>
      const budgetEnforced = input.reservationMicro > 0
      let canReserve = true
      for (const scope of budgetEnforced ? budgetScopes(input) : []) {
        const account = await client.query<{ available: string }>(
          `SELECT (limit_micro - reserved_micro - spent_micro)::text AS available
           FROM llm_budget_accounts WHERE scope_type=$1 AND scope_id=$2 FOR UPDATE`,
          [scope.type, scope.id],
        )
        accounts.push(scope)
        if (!account.rows[0] || BigInt(account.rows[0].available) < BigInt(input.reservationMicro)) canReserve = false
      }
      const id = randomUUID()
      const state: LlmJobState = canReserve ? 'queued' : 'budget_wait'
      const reserved = canReserve ? input.reservationMicro : 0
      await client.query(
        `INSERT INTO llm_jobs
         (id,organization_id,project_id,analysis_run_id,kind,provider,model,idempotency_key,input_digest,
          prompt_version,schema_version,routing_policy,state,priority,estimated_input_tokens,max_output_tokens,
          requested_reservation_micro,reserved_micro,max_attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [id, input.organizationId, input.projectId, input.analysisRunId, input.kind, input.provider, input.model,
          idempotencyKey, input.inputDigest, input.promptVersion, input.schemaVersion, input.routingPolicy, state,
          input.priority || 0, input.estimatedInputTokens, input.maxOutputTokens, input.reservationMicro,
          reserved, input.maxAttempts || 3],
      )
      if (input.deadlineAt) {
        await client.query(`UPDATE llm_jobs SET deadline_at=$2 WHERE id=$1`, [id, input.deadlineAt.toISOString()])
      }
      if (canReserve && reserved > 0) {
        for (const scope of accounts) {
          await client.query(
            `UPDATE llm_budget_accounts SET reserved_micro=reserved_micro+$3, updated_at=NOW()
             WHERE scope_type=$1 AND scope_id=$2`, [scope.type, scope.id, reserved],
          )
          await client.query(
            `INSERT INTO llm_budget_ledger
             (id,job_id,scope_type,scope_id,entry_type,reserved_delta_micro,spent_delta_micro)
             VALUES ($1,$2,$3,$4,'reservation',$5,0)`,
            [randomUUID(), id, scope.type, scope.id, reserved],
          )
        }
      }
      return { id, state, created: true }
    })
  }

  async retryBudgetWait(jobId: string) {
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string; organizationId: string; projectId: string; analysisRunId: string; reservationMicro: number
      }>(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",analysis_run_id AS "analysisRunId",
          requested_reservation_micro AS "reservationMicro"
         FROM llm_jobs j WHERE id=$1 AND state='budget_wait' FOR UPDATE`, [jobId],
      )
      const job = found.rows[0]
      if (!job) return false
      const requested = Number(job.reservationMicro)
      if (!Number.isSafeInteger(requested) || requested <= 0) return false
      for (const scope of budgetScopes(job)) {
        const account = await client.query<{ available: string }>(
          `SELECT (limit_micro-reserved_micro-spent_micro)::text AS available
           FROM llm_budget_accounts WHERE scope_type=$1 AND scope_id=$2 FOR UPDATE`, [scope.type, scope.id],
        )
        if (!account.rows[0] || BigInt(account.rows[0].available) < BigInt(requested)) return false
      }
      for (const scope of budgetScopes(job)) {
        await client.query(
          `UPDATE llm_budget_accounts SET reserved_micro=reserved_micro+$3,updated_at=NOW()
           WHERE scope_type=$1 AND scope_id=$2`, [scope.type, scope.id, requested],
        )
        await client.query(
          `INSERT INTO llm_budget_ledger
           (id,job_id,scope_type,scope_id,entry_type,reserved_delta_micro,spent_delta_micro)
           VALUES ($1,$2,$3,$4,'reservation',$5,0) ON CONFLICT DO NOTHING`,
          [randomUUID(), jobId, scope.type, scope.id, requested],
        )
      }
      await client.query(`UPDATE llm_jobs SET state='queued',reserved_micro=$2,available_at=NOW(),updated_at=NOW() WHERE id=$1`, [jobId, requested])
      return true
    })
  }

  async leaseNext(input: { provider: string; model: string; workerId: string; leaseMs: number; now?: Date }): Promise<LeasedLlmJob | null> {
    positiveSafeInteger(input.leaseMs, 'lease_ms', false)
    const now = input.now || new Date()
    const nowIso = now.toISOString()
    return this.database.transaction(async (client) => {
      await client.query(
        `WITH expired AS (
           UPDATE llm_jobs SET state='retry_wait', available_at=$1, retry_after=$1,
             lease_owner=NULL, lease_token_hash=NULL, lease_expires_at=NULL, updated_at=$1
           WHERE state IN ('leased','running') AND lease_expires_at <= $1
           RETURNING id, attempt_count, provider, model
         )
         INSERT INTO llm_attempts (id,job_id,attempt_number,provider,model,outcome,started_at,completed_at)
         SELECT gen_random_uuid(),id,attempt_count,provider,model,'reclaimed',$1,$1 FROM expired`, [nowIso],
      )

      // Lock control-plane rows in a stable order. Every lease governed by a configured
      // global/provider limit must pass these locks, so the following active-job counts
      // and state transition form one atomic admission decision.
      const globalLimit = await client.query<{ maxInFlight: number }>(
        `SELECT max_in_flight AS "maxInFlight" FROM llm_concurrency_limits
         WHERE scope_type='global' AND scope_id='global' FOR UPDATE`,
      )
      const providerLimit = await client.query<{ maxInFlight: number }>(
        `SELECT max_in_flight AS "maxInFlight" FROM llm_concurrency_limits
         WHERE scope_type='provider_model' AND scope_id=$1 AND provider=$2 AND model=$3 FOR UPDATE`,
        [providerModelScopeId(input.provider, input.model), input.provider, input.model],
      )
      const activeGlobal = globalLimit.rows[0]
        ? await client.query<{ count: number; earliestExpiry: string | null }>(
          `SELECT COUNT(*)::int AS count,MIN(lease_expires_at) AS "earliestExpiry" FROM llm_jobs
           WHERE state IN ('leased','running') AND lease_expires_at > $1`, [nowIso],
        )
        : { rows: [] }
      const activeProvider = providerLimit.rows[0]
        ? await client.query<{ count: number; earliestExpiry: string | null }>(
          `SELECT COUNT(*)::int AS count,MIN(lease_expires_at) AS "earliestExpiry" FROM llm_jobs
           WHERE provider=$1 AND model=$2 AND state IN ('leased','running') AND lease_expires_at > $3`,
          [input.provider, input.model, nowIso],
        )
        : { rows: [] }

      while (true) {
        const candidate = await client.query<{
          id: string; organizationId: string; projectId: string; analysisRunId: string; kind: string
          provider: string; model: string; promptVersion: string; schemaVersion: string; routingPolicy: string
          estimatedInputTokens: number; maxOutputTokens: number; attemptCount: number
          deadlineAt: string | null
        }>(
          `SELECT j.id,j.organization_id AS "organizationId",j.project_id AS "projectId",
            j.analysis_run_id AS "analysisRunId",j.kind,j.provider,j.model,
            j.prompt_version AS "promptVersion",j.schema_version AS "schemaVersion",
            j.routing_policy AS "routingPolicy",
            j.estimated_input_tokens AS "estimatedInputTokens",j.max_output_tokens AS "maxOutputTokens",
            j.attempt_count AS "attemptCount",j.deadline_at AS "deadlineAt"
           FROM llm_jobs j
           WHERE j.provider=$1 AND j.model=$2
             AND (j.reserved_micro > 0 OR j.requested_reservation_micro = 0)
             AND j.state IN ('queued','retry_wait','rate_wait') AND j.available_at <= $3
           ORDER BY (
             SELECT MAX(f.last_leased_at) FROM llm_jobs f WHERE f.organization_id=j.organization_id
           ) ASC NULLS FIRST, j.priority DESC, j.created_at ASC
           LIMIT 1 FOR UPDATE SKIP LOCKED`, [input.provider, input.model, nowIso],
        )
        const job = candidate.rows[0]
        if (!job) return null

        const organizationLimit = await client.query<{ maxInFlight: number }>(
          `SELECT max_in_flight AS "maxInFlight" FROM llm_concurrency_limits
           WHERE scope_type='organization' AND scope_id=$1 AND organization_id=$1::uuid FOR UPDATE`,
          [job.organizationId],
        )
        const activeOrganization = organizationLimit.rows[0]
          ? await client.query<{ count: number; earliestExpiry: string | null }>(
            `SELECT COUNT(*)::int AS count,MIN(lease_expires_at) AS "earliestExpiry" FROM llm_jobs
             WHERE organization_id=$1 AND state IN ('leased','running') AND lease_expires_at > $2`,
            [job.organizationId, nowIso],
          )
          : { rows: [] }

        const saturated = [
          globalLimit.rows[0] && activeGlobal.rows[0] && activeGlobal.rows[0].count >= globalLimit.rows[0].maxInFlight
            ? { reason: 'CONCURRENCY_GLOBAL', earliestExpiry: activeGlobal.rows[0].earliestExpiry } : null,
          providerLimit.rows[0] && activeProvider.rows[0] && activeProvider.rows[0].count >= providerLimit.rows[0].maxInFlight
            ? { reason: 'CONCURRENCY_PROVIDER_MODEL', earliestExpiry: activeProvider.rows[0].earliestExpiry } : null,
          organizationLimit.rows[0] && activeOrganization.rows[0] && activeOrganization.rows[0].count >= organizationLimit.rows[0].maxInFlight
            ? { reason: 'CONCURRENCY_ORGANIZATION', earliestExpiry: activeOrganization.rows[0].earliestExpiry } : null,
        ].filter((value): value is { reason: string; earliestExpiry: string | null } => value !== null)
        if (saturated.length > 0) {
          const retryAt = concurrencyRetryAt(now, saturated
            .map((limit) => limit.earliestExpiry)
            .filter((value): value is string => value !== null)
            .sort()
            .slice(-1)[0] || null)
          await client.query(
            `UPDATE llm_jobs SET state='rate_wait',available_at=$2,retry_after=$2,last_error_code=$3,updated_at=$1
             WHERE id=$4`, [nowIso, retryAt, saturated[0].reason, job.id],
          )
          // A tenant-local cap must not leave provider capacity idle. Continue to the
          // next fair SKIP LOCKED candidate; global/provider saturation blocks the lane.
          if (saturated.some((limit) => limit.reason !== 'CONCURRENCY_ORGANIZATION')) return null
          continue
        }

      const rate = await client.query<{
        requestCapacity: number; requestTokens: number; requestsPerSecond: number
        tokenCapacity: number; tokenTokens: number; tokensPerSecond: number; refilledAt: string
      }>(
        `SELECT request_capacity AS "requestCapacity",request_tokens AS "requestTokens",
          requests_per_second AS "requestsPerSecond",token_capacity AS "tokenCapacity",
          token_tokens AS "tokenTokens",tokens_per_second AS "tokensPerSecond",refilled_at AS "refilledAt"
         FROM llm_rate_buckets WHERE provider=$1 AND model=$2 FOR UPDATE`, [input.provider, input.model],
      )
      if (!rate.rows[0]) throw new Error('LLM_RATE_BUCKET_MISSING')
      const elapsed = Math.max(0, (now.getTime() - new Date(rate.rows[0].refilledAt).getTime()) / 1000)
      const requests = Math.min(rate.rows[0].requestCapacity, rate.rows[0].requestTokens + elapsed * rate.rows[0].requestsPerSecond)
      const tokens = Math.min(rate.rows[0].tokenCapacity, rate.rows[0].tokenTokens + elapsed * rate.rows[0].tokensPerSecond)
      const requiredTokens = job.estimatedInputTokens + job.maxOutputTokens
      if (requests < 1 || tokens < requiredTokens) {
        const requestWait = requests >= 1 ? 0 : rate.rows[0].requestsPerSecond > 0 ? (1 - requests) / rate.rows[0].requestsPerSecond : 60
        const tokenWait = tokens >= requiredTokens ? 0 : rate.rows[0].tokensPerSecond > 0 ? (requiredTokens - tokens) / rate.rows[0].tokensPerSecond : 60
        const next = new Date(now.getTime() + Math.max(1, requestWait, tokenWait) * 1000).toISOString()
        await client.query(`UPDATE llm_jobs SET state='rate_wait',available_at=$2,retry_after=$2,updated_at=$1 WHERE id=$3`, [nowIso, next, job.id])
        await client.query(
          `UPDATE llm_rate_buckets SET request_tokens=$3,token_tokens=$4,refilled_at=$5,updated_at=$5
           WHERE provider=$1 AND model=$2`, [input.provider, input.model, requests, tokens, nowIso],
        )
        return null
      }
      await client.query(
        `UPDATE llm_rate_buckets SET request_tokens=$3,token_tokens=$4,refilled_at=$5,updated_at=$5
         WHERE provider=$1 AND model=$2`, [input.provider, input.model, requests - 1, tokens - requiredTokens, nowIso],
      )
      const leaseToken = randomBytes(32).toString('base64url')
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString()
      const attemptNumber = job.attemptCount + 1
      await client.query(
        `UPDATE llm_jobs SET state='leased',attempt_count=$2,lease_owner=$3,lease_token_hash=$4,
          lease_expires_at=$5,last_leased_at=$6,retry_after=NULL,last_error_code=NULL,updated_at=$6 WHERE id=$1`,
        [job.id, attemptNumber, input.workerId, hash(leaseToken), leaseExpiresAt, nowIso],
      )
      await client.query(
        `INSERT INTO llm_attempts (id,job_id,attempt_number,provider,model,outcome,started_at)
         VALUES ($1,$2,$3,$4,$5,'leased',$6)`,
        [randomUUID(), job.id, attemptNumber, job.provider, job.model, nowIso],
      )
      return { ...job, attemptNumber, leaseToken, leaseExpiresAt }
      }
    })
  }

  async heartbeat(jobId: string, leaseToken: string, extendMs: number, now = new Date()) {
    positiveSafeInteger(extendMs, 'extend_ms', false)
    const result = await this.database.query(
      `UPDATE llm_jobs SET lease_expires_at=$3,updated_at=$2
       WHERE id=$1 AND state IN ('leased','running') AND lease_token_hash=$4 AND lease_expires_at>$2 RETURNING id`,
      [jobId, now.toISOString(), new Date(now.getTime() + extendMs).toISOString(), hash(leaseToken)],
    )
    return result.rows.length === 1
  }

  async markRunning(jobId: string, leaseToken: string, now = new Date()) {
    return this.database.transaction(async (client) => {
      const job = await client.query<{ attemptCount: number }>(
        `UPDATE llm_jobs SET state='running',updated_at=$3
         WHERE id=$1 AND state='leased' AND lease_token_hash=$2 AND lease_expires_at>$3
         RETURNING attempt_count AS "attemptCount"`, [jobId, hash(leaseToken), now.toISOString()],
      )
      if (!job.rows[0]) return false
      await client.query(
        `INSERT INTO llm_attempts (id,job_id,attempt_number,provider,model,outcome,started_at)
         SELECT $1,id,attempt_count,provider,model,'running',$3 FROM llm_jobs WHERE id=$2`,
        [randomUUID(), jobId, now.toISOString()],
      )
      return true
    })
  }

  async complete(jobId: string, leaseToken: string, input: {
    result: unknown; inputTokens?: number; outputTokens?: number; actualMicro?: number; usageVerified: boolean; now?: Date
  }) {
    const now = input.now || new Date()
    for (const [field, value] of [['input_tokens', input.inputTokens], ['output_tokens', input.outputTokens], ['actual_micro', input.actualMicro]] as const) {
      if (value !== undefined) positiveSafeInteger(value, field)
    }
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string; organizationId: string; projectId: string; analysisRunId: string
        reservedMicro: number; attemptCount: number; state: LlmJobState; provider: string; model: string
      }>(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",analysis_run_id AS "analysisRunId",
          reserved_micro AS "reservedMicro",attempt_count AS "attemptCount",state,provider,model
         FROM llm_jobs WHERE id=$1 FOR UPDATE`, [jobId],
      )
      const job = found.rows[0]
      if (!job || !['leased', 'running'].includes(job.state) || !(await this.validLease(client, jobId, leaseToken, now))) return false
      const charged = job.reservedMicro === 0 ? 0 : input.usageVerified ? input.actualMicro : job.reservedMicro
      if (charged === undefined || charged > job.reservedMicro) throw new Error('LLM_USAGE_EXCEEDS_RESERVATION')
      for (const scope of job.reservedMicro > 0 ? budgetScopes(job) : []) {
        const updated = await client.query(
          `UPDATE llm_budget_accounts SET reserved_micro=reserved_micro-$3,spent_micro=spent_micro+$4,updated_at=$5
           WHERE scope_type=$1 AND scope_id=$2 AND reserved_micro >= $3 RETURNING scope_id`,
          [scope.type, scope.id, job.reservedMicro, charged, now.toISOString()],
        )
        if (!updated.rows[0]) throw new Error('LLM_BUDGET_RECONCILIATION_FAILED')
        await client.query(
          `INSERT INTO llm_budget_ledger
           (id,job_id,scope_type,scope_id,entry_type,reserved_delta_micro,spent_delta_micro,usage_verified)
           VALUES ($1,$2,$3,$4,'reconciliation',$5,$6,$7)`,
          [randomUUID(), jobId, scope.type, scope.id, -job.reservedMicro, charged, input.usageVerified],
        )
      }
      await client.query(
        `UPDATE llm_jobs SET state='succeeded',reserved_micro=0,result_payload=$2,lease_owner=NULL,
          lease_token_hash=NULL,lease_expires_at=NULL,completed_at=$3,updated_at=$3 WHERE id=$1`,
        [jobId, JSON.stringify(input.result), now.toISOString()],
      )
      await client.query(
        `INSERT INTO llm_attempts
         (id,job_id,attempt_number,provider,model,outcome,input_tokens,output_tokens,charged_micro,usage_verified,started_at,completed_at)
         VALUES ($1,$2,$3,$4,$5,'succeeded',$6,$7,$8,$9,$10,$10)`,
        [randomUUID(), jobId, job.attemptCount, job.provider, job.model, input.inputTokens ?? null,
          input.outputTokens ?? null, charged, input.usageVerified, now.toISOString()],
      )
      return true
    })
  }

  async fail(jobId: string, leaseToken: string, input: { errorCode: string; retryAfter?: Date; now?: Date; retryable?: boolean }) {
    const now = input.now || new Date()
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string; organizationId: string; projectId: string; analysisRunId: string
        reservedMicro: number; attemptCount: number; maxAttempts: number; state: LlmJobState; provider: string; model: string
      }>(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",analysis_run_id AS "analysisRunId",
          reserved_micro AS "reservedMicro",attempt_count AS "attemptCount",max_attempts AS "maxAttempts",state,provider,model
         FROM llm_jobs WHERE id=$1 FOR UPDATE`, [jobId],
      )
      const job = found.rows[0]
      if (!job || !['leased', 'running'].includes(job.state) || !(await this.validLease(client, jobId, leaseToken, now))) return false
      const dead = input.retryable === false || job.attemptCount >= job.maxAttempts
      const retryAt = input.retryAfter || new Date(now.getTime() + Math.min(60_000, 1000 * 2 ** Math.max(0, job.attemptCount - 1)))
      if (dead) await releaseReservation(client, job)
      await client.query(
        `UPDATE llm_jobs SET state=$2,reserved_micro=$3,available_at=$4,retry_after=$5,last_error_code=$6,
          lease_owner=NULL,lease_token_hash=NULL,lease_expires_at=NULL,completed_at=$7,updated_at=$8 WHERE id=$1`,
        [jobId, dead ? 'dead_lettered' : 'retry_wait', dead ? 0 : job.reservedMicro,
          retryAt.toISOString(), dead ? null : retryAt.toISOString(), input.errorCode,
          dead ? now.toISOString() : null, now.toISOString()],
      )
      await client.query(
        `INSERT INTO llm_attempts
         (id,job_id,attempt_number,provider,model,outcome,error_code,started_at,completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [randomUUID(), jobId, job.attemptCount, job.provider, job.model, dead ? 'failed' : 'retry',
          input.errorCode, now.toISOString()],
      )
      return true
    })
  }

  async completeFallback(jobId: string, now = new Date(), reason = 'DETERMINISTIC_FALLBACK') {
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string; organizationId: string; projectId: string; analysisRunId: string; reservedMicro: number; state: LlmJobState
      }>(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",analysis_run_id AS "analysisRunId",
          reserved_micro AS "reservedMicro",state FROM llm_jobs WHERE id=$1 FOR UPDATE`, [jobId],
      )
      const job = found.rows[0]
      if (!job || ['succeeded', 'cancelled', 'fallback_completed'].includes(job.state)) return false
      await releaseReservation(client, job)
      await client.query(
        `UPDATE llm_jobs SET state='fallback_completed',reserved_micro=0,lease_owner=NULL,lease_token_hash=NULL,
          lease_expires_at=NULL,last_error_code=$3,completed_at=$2,updated_at=$2 WHERE id=$1`, [jobId, now.toISOString(), reason],
      )
      return true
    })
  }

  async getJobState(jobId: string) {
    const result = await this.database.query<{ state: LlmJobState }>(`SELECT state FROM llm_jobs WHERE id=$1`, [jobId])
    return result.rows[0]?.state ?? null
  }

  async fallbackNext(input: { provider: string; model: string; reason: string; now?: Date; states?: LlmJobState[] }) {
    const states = input.states || ['queued', 'budget_wait', 'rate_wait', 'retry_wait']
    const found = await this.database.query<{ id: string }>(
      `SELECT id FROM llm_jobs WHERE provider=$1 AND model=$2 AND state = ANY($3::text[])
       ORDER BY priority DESC,created_at ASC LIMIT 1`, [input.provider, input.model, states],
    )
    return found.rows[0] ? this.completeFallback(found.rows[0].id, input.now, input.reason) : false
  }

  async fallbackExpired(provider: string, model: string, now = new Date()) {
    const found = await this.database.query<{ id: string }>(
      `SELECT id FROM llm_jobs WHERE provider=$1 AND model=$2 AND deadline_at IS NOT NULL AND deadline_at <= $3
       AND state IN ('queued','budget_wait','rate_wait','retry_wait','dead_lettered') ORDER BY created_at`,
      [provider, model, now.toISOString()],
    )
    let count = 0
    for (const row of found.rows) if (await this.completeFallback(row.id, now, 'DEADLINE_EXHAUSTED')) count += 1
    return count
  }

  async configureProviderHealth(input: {
    provider: string; model: string; enabled?: boolean; failureThreshold?: number; cooldownMs?: number
  }) {
    positiveSafeInteger(input.failureThreshold ?? 3, 'failure_threshold', false)
    positiveSafeInteger(input.cooldownMs ?? 60_000, 'cooldown_ms', false)
    await this.database.query(
      `INSERT INTO llm_provider_health(provider,model,enabled,failure_threshold,cooldown_ms)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT(provider,model) DO UPDATE SET enabled=EXCLUDED.enabled,
       failure_threshold=EXCLUDED.failure_threshold,cooldown_ms=EXCLUDED.cooldown_ms,updated_at=NOW()`,
      [input.provider, input.model, input.enabled ?? true, input.failureThreshold ?? 3, input.cooldownMs ?? 60_000],
    )
  }

  async claimProvider(provider: string, model: string, now = new Date()) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{
        enabled: boolean; state: 'closed' | 'open' | 'half_open'; nextProbeAt: string | null; inFlight: boolean
      }>(
        `SELECT enabled,circuit_state AS state,next_probe_at AS "nextProbeAt",half_open_in_flight AS "inFlight"
         FROM llm_provider_health WHERE provider=$1 AND model=$2 FOR UPDATE`, [provider, model],
      )
      const health = result.rows[0]
      if (!health) throw new Error('LLM_PROVIDER_HEALTH_MISSING')
      if (!health.enabled) return { allowed: false, reason: 'PROVIDER_DISABLED', probe: false }
      if (health.state === 'closed') return { allowed: true, reason: null, probe: false }
      if (health.state === 'open') {
        if (!health.nextProbeAt || new Date(health.nextProbeAt).getTime() > now.getTime()) {
          return { allowed: false, reason: 'CIRCUIT_OPEN', probe: false }
        }
        await client.query(
          `UPDATE llm_provider_health SET circuit_state='half_open',half_open_in_flight=TRUE,updated_at=$3
           WHERE provider=$1 AND model=$2`, [provider, model, now.toISOString()],
        )
        return { allowed: true, reason: null, probe: true }
      }
      if (health.inFlight) return { allowed: false, reason: 'CIRCUIT_HALF_OPEN_BUSY', probe: false }
      await client.query(
        `UPDATE llm_provider_health SET half_open_in_flight=TRUE,updated_at=$3 WHERE provider=$1 AND model=$2`,
        [provider, model, now.toISOString()],
      )
      return { allowed: true, reason: null, probe: true }
    })
  }

  async releaseProviderProbe(provider: string, model: string, now = new Date()) {
    await this.database.query(
      `UPDATE llm_provider_health SET half_open_in_flight=FALSE,updated_at=$3
       WHERE provider=$1 AND model=$2 AND circuit_state='half_open'`, [provider, model, now.toISOString()],
    )
  }

  async recordProviderSuccess(provider: string, model: string, now = new Date()) {
    await this.database.query(
      `UPDATE llm_provider_health SET circuit_state='closed',consecutive_failures=0,half_open_in_flight=FALSE,
       opened_at=NULL,next_probe_at=NULL,last_outcome='success',updated_at=$3 WHERE provider=$1 AND model=$2`,
      [provider, model, now.toISOString()],
    )
  }

  async recordProviderFailure(provider: string, model: string, now = new Date()) {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ state: string; failures: number; threshold: number; cooldownMs: number }>(
        `SELECT circuit_state AS state,consecutive_failures AS failures,failure_threshold AS threshold,
         cooldown_ms AS "cooldownMs" FROM llm_provider_health WHERE provider=$1 AND model=$2 FOR UPDATE`,
        [provider, model],
      )
      const health = result.rows[0]
      if (!health) throw new Error('LLM_PROVIDER_HEALTH_MISSING')
      const failures = health.failures + 1
      const opens = health.state === 'half_open' || failures >= health.threshold
      await client.query(
        `UPDATE llm_provider_health SET circuit_state=$3,consecutive_failures=$4,half_open_in_flight=FALSE,
         opened_at=$5,next_probe_at=$6,last_outcome='failure',updated_at=$5 WHERE provider=$1 AND model=$2`,
        [provider, model, opens ? 'open' : 'closed', failures, now.toISOString(),
          opens ? new Date(now.getTime() + health.cooldownMs).toISOString() : null],
      )
    })
  }

  async cancel(jobId: string, now = new Date()) {
    return this.database.transaction(async (client) => {
      const found = await client.query<{
        id: string; organizationId: string; projectId: string; analysisRunId: string; reservedMicro: number; state: LlmJobState
      }>(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",analysis_run_id AS "analysisRunId",
          reserved_micro AS "reservedMicro",state FROM llm_jobs WHERE id=$1 FOR UPDATE`, [jobId],
      )
      const job = found.rows[0]
      if (!job || ['succeeded', 'dead_lettered', 'cancelled', 'fallback_completed'].includes(job.state)) return false
      await releaseReservation(client, job)
      await client.query(
        `UPDATE llm_jobs SET state='cancelled',reserved_micro=0,lease_owner=NULL,lease_token_hash=NULL,
          lease_expires_at=NULL,completed_at=$2,updated_at=$2 WHERE id=$1`, [jobId, now.toISOString()],
      )
      return true
    })
  }

  private async validLease(client: DatabaseClient, jobId: string, leaseToken: string, now: Date) {
    const valid = await client.query(
      `SELECT 1 FROM llm_jobs WHERE id=$1 AND lease_token_hash=$2 AND lease_expires_at>$3`,
      [jobId, hash(leaseToken), now.toISOString()],
    )
    return Boolean(valid.rows[0])
  }
}
