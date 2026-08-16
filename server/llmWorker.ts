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
  route?: 'primary' | 'fallback'
  retryAfterMs?: number
  delayReason?: 'retry_after' | 'exponential_backoff'
}

export type LlmWorkerOptions = {
  queue: DurableLlmQueue
  provider: LlmWorkerProvider | null
  providerName: string
  model: string
  fallbackModel?: string
  workerId: string
  resolveWork(job: LeasedLlmJob): Promise<GovernedWork>
  acceptCandidate(completion: LlmCompletion, job: LeasedLlmJob): Promise<unknown> | unknown
  calculateCostMicro(completion: LlmCompletion): number | null
  clock?: () => Date
  random?: () => number
  leaseMs?: number
  maxBackoffMs?: number
  fallbackBudgetWait?: boolean
  recoverTerminalFailure?: (job: LeasedLlmJob, reason: string) => Promise<boolean>
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
      return { code: error.code, retryable: true, retryAfterMs: error.retryAfterMs, affectsCircuit: true }
    case 'INVALID_RESPONSE':
    case 'REASONING_ONLY_TRUNCATED':
      return { code: error.code, retryable: false, retryAfterMs: null, affectsCircuit: false }
    case 'AUTHENTICATION_FAILED':
    case 'MODEL_UNAVAILABLE':
      return { code: error.code, retryable: false, retryAfterMs: null, affectsCircuit: true }
  }
}

function sanitizedReason(reason: string) {
  return reason.replace(/[^A-Z0-9_]/gi, '_').slice(0, 80) || 'UNKNOWN'
}

const isTransient = (failure: Failure) => failure.code === 'RATE_LIMITED' || failure.code === 'PROVIDER_UNAVAILABLE'

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
      let route: 'primary' | 'fallback' = 'primary'
      let actualModel = lease.model
      let fallbackReason: string | undefined
      let completion: LlmCompletion
      try {
        completion = await this.options.provider.complete({ ...work, model: lease.model })
      } catch (primaryError) {
        const primaryFailure = classifyLlmFailure(primaryError)
        const failedAt = this.clock()
        const fallbackModel = this.options.fallbackModel
        const canFallback = isTransient(primaryFailure) && fallbackModel && fallbackModel !== lease.model
          && !(await this.options.queue.hasAttemptForModel(lease.id, fallbackModel))
        if (!canFallback) throw primaryError
        if (primaryFailure.affectsCircuit) await this.options.queue.recordProviderFailure(lease.provider, lease.model, failedAt)
        else if (circuit.probe) await this.options.queue.releaseProviderProbe(lease.provider, lease.model, failedAt)
        if (!(await this.options.queue.recordAttemptFailure(lease.id, lease.leaseToken, {
          model: lease.model, errorCode: primaryFailure.code, now: failedAt,
        }))) throw new Error('LEASE_LOST')
        route = 'fallback'
        actualModel = fallbackModel
        fallbackReason = primaryFailure.code
        let fallbackProbe = false
        try {
          const fallbackCircuit = await this.options.queue.claimProvider(lease.provider, fallbackModel, failedAt)
          if (!fallbackCircuit.allowed) throw new LlmProviderError('PROVIDER_UNAVAILABLE', sanitizedReason(fallbackCircuit.reason || 'CIRCUIT_OPEN'))
          fallbackProbe = fallbackCircuit.probe
          completion = await this.options.provider.complete({ ...work, model: fallbackModel })
        } catch (fallbackError) {
          const fallbackFailure = classifyLlmFailure(fallbackError)
          const fallbackFailedAt = this.clock()
          if (fallbackFailure.affectsCircuit) await this.options.queue.recordProviderFailure(lease.provider, fallbackModel, fallbackFailedAt)
          else if (fallbackProbe) await this.options.queue.releaseProviderProbe(lease.provider, fallbackModel, fallbackFailedAt)
          const { retryAfterMs, delayReason } = this.retryDelay(fallbackFailure, lease.attemptNumber)
          const reason = `FALLBACK_${fallbackFailure.code}`
          await this.options.queue.fail(lease.id, lease.leaseToken, {
            errorCode: reason, model: fallbackModel, retryable: isTransient(fallbackFailure),
            retryAfter: isTransient(fallbackFailure) ? new Date(fallbackFailedAt.getTime() + retryAfterMs) : undefined,
            now: fallbackFailedAt,
          })
          const state = await this.options.queue.getJobState(lease.id)
          if (!isTransient(fallbackFailure) || state === 'dead_lettered') {
            await this.options.queue.completeFallback(lease.id, fallbackFailedAt, reason)
            return this.emit({ type: 'fallback', jobId: lease.id, provider: lease.provider, model: fallbackModel, route, reason })
          }
          return this.emit({ type: 'retry', jobId: lease.id, provider: lease.provider, model: fallbackModel,
            route, reason, retryAfterMs, delayReason })
        }
      }
      await this.options.queue.recordProviderSuccess(lease.provider, actualModel, this.clock())
      const actualJob = actualModel === lease.model ? lease : { ...lease, model: actualModel }
      const candidate = await this.options.acceptCandidate(completion, actualJob)
      const actualMicro = this.options.calculateCostMicro(completion)
      const usageVerified = actualMicro !== null && completion.usage.inputTokens !== null && completion.usage.outputTokens !== null
      const accepted = await this.options.queue.complete(lease.id, lease.leaseToken, {
        result: candidate,
        inputTokens: completion.usage.inputTokens ?? undefined,
        outputTokens: completion.usage.outputTokens ?? undefined,
        actualMicro: actualMicro ?? undefined,
        usageVerified,
        model: actualModel,
        now: this.clock(),
      })
      if (!accepted) return this.emit({ type: 'idle', jobId: lease.id, provider: lease.provider, model: actualModel, route, reason: 'LEASE_LOST' })
      return this.emit({ type: 'completed', jobId: lease.id, provider: lease.provider, model: actualModel, route, reason: fallbackReason })
    } catch (error) {
      const failure = classifyLlmFailure(error)
      const failedAt = this.clock()
      if (failure.affectsCircuit) await this.options.queue.recordProviderFailure(lease.provider, lease.model, failedAt)
      else if (circuit.probe) await this.options.queue.releaseProviderProbe(lease.provider, lease.model, failedAt)
      const { retryAfterMs, delayReason } = this.retryDelay(failure, lease.attemptNumber)
      await this.options.queue.fail(lease.id, lease.leaseToken, {
        errorCode: failure.code,
        retryable: failure.retryable,
        retryAfter: failure.retryable ? new Date(failedAt.getTime() + retryAfterMs) : undefined,
        now: failedAt,
      })
      const state = await this.options.queue.getJobState(lease.id)
      if (!failure.retryable || state === 'dead_lettered') {
        const reason = failure.retryable ? 'RETRY_EXHAUSTED' : failure.code
        const recoveryQueued = this.options.fallbackModel ? false
          : await this.options.recoverTerminalFailure?.(lease, reason).catch(() => false) ?? false
        await this.options.queue.completeFallback(lease.id, failedAt, reason)
        return this.emit({ type: 'fallback', jobId: lease.id, provider: lease.provider, model: lease.model, reason: recoveryQueued ? 'RECOVERY_QUEUED' : reason })
      }
      return this.emit({ type: 'retry', jobId: lease.id, provider: lease.provider, model: lease.model, route: 'primary',
        reason: failure.code, retryAfterMs, delayReason })
    } finally {
      clearInterval(heartbeatTimer)
    }
  }

  private retryDelay(failure: Failure, attemptNumber: number) {
    if (failure.retryAfterMs !== null) {
      return { retryAfterMs: Math.min(this.maxBackoffMs, Math.max(0, failure.retryAfterMs)), delayReason: 'retry_after' as const }
    }
    const ceiling = Math.min(this.maxBackoffMs, 1_000 * 2 ** Math.max(0, attemptNumber - 1))
    return { retryAfterMs: Math.max(1, Math.floor(ceiling * this.random())), delayReason: 'exponential_backoff' as const }
  }

  private emit(event: WorkerEvent) {
    this.options.onEvent?.(event)
    return event
  }
}
