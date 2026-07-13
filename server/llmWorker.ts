import type { DurableLlmQueue, LeasedLlmJob } from './llmQueue'
import { LlmProviderError, type CompleteRequest, type LlmCompletion } from './llmProvider'

export type LlmWorkerProvider = {
  complete(input: CompleteRequest): Promise<LlmCompletion>
}

export type GovernedWork = CompleteRequest

export type WorkerEvent = {
  type: 'fallback' | 'retry' | 'completed' | 'idle'
  jobId?: string
  provider: string
  model: string
  reason?: string
}

export type LlmWorkerOptions = {
  queue: DurableLlmQueue
  provider: LlmWorkerProvider | null
  providerName: string
  model: string
  workerId: string
  resolveWork(job: LeasedLlmJob): Promise<GovernedWork>
  acceptCandidate(completion: LlmCompletion, job: LeasedLlmJob): Promise<unknown> | unknown
  calculateCostMicro(completion: LlmCompletion): number | null
  clock?: () => Date
  random?: () => number
  leaseMs?: number
  maxBackoffMs?: number
  fallbackBudgetWait?: boolean
  onEvent?: (event: WorkerEvent) => void
}

type Failure = {
  code: string
  retryable: boolean
  retryAfterMs: number | null
  affectsCircuit: boolean
}

export function classifyLlmFailure(error: unknown): Failure {
  if (!(error instanceof LlmProviderError)) {
    return { code: 'WORK_REJECTED', retryable: false, retryAfterMs: null, affectsCircuit: false }
  }
  switch (error.code) {
    case 'RATE_LIMITED':
      return { code: error.code, retryable: true, retryAfterMs: error.retryAfterMs, affectsCircuit: false }
    case 'PROVIDER_UNAVAILABLE':
    case 'INVALID_RESPONSE':
      return { code: error.code, retryable: true, retryAfterMs: error.retryAfterMs, affectsCircuit: true }
    case 'AUTHENTICATION_FAILED':
    case 'MODEL_UNAVAILABLE':
      return { code: error.code, retryable: false, retryAfterMs: null, affectsCircuit: true }
  }
}

function sanitizedReason(reason: string) {
  return reason.replace(/[^A-Z0-9_]/gi, '_').slice(0, 80) || 'UNKNOWN'
}

export class LlmWorkerRuntime {
  private readonly clock: () => Date
  private readonly random: () => number
  private readonly leaseMs: number
  private readonly maxBackoffMs: number

  constructor(private readonly options: LlmWorkerOptions) {
    this.clock = options.clock || (() => new Date())
    this.random = options.random || Math.random
    this.leaseMs = options.leaseMs ?? 60_000
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000
  }

  async runOnce(): Promise<WorkerEvent> {
    const now = this.clock()
    await this.options.queue.fallbackExpired(this.options.providerName, this.options.model, now)

    if (this.options.fallbackBudgetWait !== false) {
      const completed = await this.options.queue.fallbackNext({
        provider: this.options.providerName,
        model: this.options.model,
        states: ['budget_wait'],
        reason: 'BUDGET_EXHAUSTED',
        now,
      })
      if (completed) return this.emit({ type: 'fallback', provider: this.options.providerName, model: this.options.model, reason: 'BUDGET_EXHAUSTED' })
    }

    if (!this.options.provider) {
      const completed = await this.options.queue.fallbackNext({
        provider: this.options.providerName, model: this.options.model, reason: 'PROVIDER_DISABLED', now,
      })
      return this.emit(completed
        ? { type: 'fallback', provider: this.options.providerName, model: this.options.model, reason: 'PROVIDER_DISABLED' }
        : { type: 'idle', provider: this.options.providerName, model: this.options.model })
    }

    const circuit = await this.options.queue.claimProvider(this.options.providerName, this.options.model, now)
    if (!circuit.allowed) {
      const reason = sanitizedReason(circuit.reason || 'CIRCUIT_OPEN')
      const completed = await this.options.queue.fallbackNext({
        provider: this.options.providerName, model: this.options.model, reason, now,
      })
      return this.emit(completed
        ? { type: 'fallback', provider: this.options.providerName, model: this.options.model, reason }
        : { type: 'idle', provider: this.options.providerName, model: this.options.model, reason })
    }

    const lease = await this.options.queue.leaseNext({
      provider: this.options.providerName,
      model: this.options.model,
      workerId: this.options.workerId,
      leaseMs: this.leaseMs,
      now,
    })
    if (!lease) {
      if (circuit.probe) await this.options.queue.releaseProviderProbe(this.options.providerName, this.options.model, now)
      return this.emit({ type: 'idle', provider: this.options.providerName, model: this.options.model })
    }
    if (lease.deadlineAt && new Date(lease.deadlineAt).getTime() <= now.getTime()) {
      await this.options.queue.completeFallback(lease.id, now, 'DEADLINE_EXHAUSTED')
      if (circuit.probe) await this.options.queue.releaseProviderProbe(this.options.providerName, this.options.model, now)
      return this.emit({ type: 'fallback', jobId: lease.id, provider: lease.provider, model: lease.model, reason: 'DEADLINE_EXHAUSTED' })
    }
    if (!(await this.options.queue.markRunning(lease.id, lease.leaseToken, now))) {
      if (circuit.probe) await this.options.queue.releaseProviderProbe(this.options.providerName, this.options.model, now)
      return this.emit({ type: 'idle', provider: lease.provider, model: lease.model, reason: 'LEASE_LOST' })
    }

    let heartbeatInFlight = false
    const heartbeatEveryMs = Math.max(10, Math.floor(this.leaseMs / 3))
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight) return
      heartbeatInFlight = true
      void this.options.queue.heartbeat(lease.id, lease.leaseToken, this.leaseMs, this.clock())
        .finally(() => { heartbeatInFlight = false })
    }, heartbeatEveryMs)

    try {
      const work = await this.options.resolveWork(lease)
      const completion = await this.options.provider.complete({ ...work, model: lease.model })
      await this.options.queue.recordProviderSuccess(lease.provider, lease.model, this.clock())
      const candidate = await this.options.acceptCandidate(completion, lease)
      const actualMicro = this.options.calculateCostMicro(completion)
      const usageVerified = actualMicro !== null && completion.usage.inputTokens !== null && completion.usage.outputTokens !== null
      const accepted = await this.options.queue.complete(lease.id, lease.leaseToken, {
        result: candidate,
        inputTokens: completion.usage.inputTokens ?? undefined,
        outputTokens: completion.usage.outputTokens ?? undefined,
        actualMicro: actualMicro ?? undefined,
        usageVerified,
        now: this.clock(),
      })
      if (!accepted) return this.emit({ type: 'idle', jobId: lease.id, provider: lease.provider, model: lease.model, reason: 'LEASE_LOST' })
      return this.emit({ type: 'completed', jobId: lease.id, provider: lease.provider, model: lease.model })
    } catch (error) {
      const failure = classifyLlmFailure(error)
      const failedAt = this.clock()
      if (failure.affectsCircuit) await this.options.queue.recordProviderFailure(lease.provider, lease.model, failedAt)
      else if (circuit.probe) await this.options.queue.releaseProviderProbe(lease.provider, lease.model, failedAt)
      const fallbackDelay = Math.min(this.maxBackoffMs, 1_000 * 2 ** Math.max(0, lease.attemptNumber - 1))
      const jitteredDelay = Math.max(1, Math.floor(fallbackDelay * this.random()))
      const retryAfterMs = failure.retryAfterMs === null
        ? jitteredDelay
        : Math.min(this.maxBackoffMs, Math.max(0, failure.retryAfterMs))
      await this.options.queue.fail(lease.id, lease.leaseToken, {
        errorCode: failure.code,
        retryable: failure.retryable,
        retryAfter: failure.retryable ? new Date(failedAt.getTime() + retryAfterMs) : undefined,
        now: failedAt,
      })
      const state = await this.options.queue.getJobState(lease.id)
      if (!failure.retryable || state === 'dead_lettered') {
        await this.options.queue.completeFallback(lease.id, failedAt, failure.retryable ? 'RETRY_EXHAUSTED' : failure.code)
        return this.emit({ type: 'fallback', jobId: lease.id, provider: lease.provider, model: lease.model, reason: failure.retryable ? 'RETRY_EXHAUSTED' : failure.code })
      }
      return this.emit({ type: 'retry', jobId: lease.id, provider: lease.provider, model: lease.model, reason: failure.code })
    } finally {
      clearInterval(heartbeatTimer)
    }
  }

  private emit(event: WorkerEvent) {
    this.options.onEvent?.(event)
    return event
  }
}
