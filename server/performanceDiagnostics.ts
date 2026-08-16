import { readFile } from 'node:fs/promises'
import type { Database } from './database'

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const text = (value: unknown, maximum = 100) => typeof value === 'string' ? value.slice(0, maximum) : ''
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : ''

export function sanitizePerformanceDiagnostics(value: unknown) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const window = input.window && typeof input.window === 'object' ? input.window as Record<string, unknown> : {}
  const runs = Array.isArray(input.runs) ? input.runs.slice(0, 50).map((candidate) => {
    const run = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
    const timings = run.timings && typeof run.timings === 'object' ? run.timings as Record<string, unknown> : {}
    const queue = run.queue && typeof run.queue === 'object' ? run.queue as Record<string, unknown> : {}
    const llm = run.llm && typeof run.llm === 'object' ? run.llm as Record<string, unknown> : {}
    return {
      runId: text(run.runId, 64), lane: run.lane === 'demo' ? 'demo' : 'authenticated', userLabel: text(run.userLabel, 40),
      stage: text(run.stage, 60), progressPercent: Math.min(100, finite(run.progressPercent)),
      timings: {
        parseValidateMs: finite(timings.parseValidateMs), csvSaveMs: finite(timings.csvSaveMs), queueWaitMs: finite(timings.queueWaitMs),
        firstEvidenceMs: finite(timings.firstEvidenceMs), completionMs: finite(timings.completionMs), aggregationPersistMs: finite(timings.aggregationPersistMs),
      },
      queue: { queued: finite(queue.queued), active: finite(queue.active), leaseState: text(queue.leaseState, 100) },
      llm: { requests: finite(llm.requests), retries: finite(llm.retries), durationMs: finite(llm.durationMs) },
      jobs: (Array.isArray(run.jobs) ? run.jobs : []).slice(0, 12).map((candidate) => {
        const job = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
        return {
          jobId: text(job.jobId, 64), status: text(job.status, 60), queueWaitMs: finite(job.queueWaitMs), progressPercent: Math.min(100, finite(job.progressPercent)),
          retries: finite(job.retries), elapsedMs: finite(job.elapsedMs), errorCode: text(job.errorCode, 80),
          attemptModels: (Array.isArray(job.attemptModels) ? job.attemptModels : []).map((model) => text(model, 128)).filter(Boolean).slice(0, 4),
          attemptErrorCodes: (Array.isArray(job.attemptErrorCodes) ? job.attemptErrorCodes : []).map((code) => text(code, 80)).filter(Boolean).slice(0, 8),
        }
      }),
      resources: (Array.isArray(run.resources) ? run.resources : []).slice(0, 500).map((candidate) => {
        const resource = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
        return {
          sampledAt: instant(resource.sampledAt), service: text(resource.service, 40), cpuPercent: finite(resource.cpuPercent),
          rssMiB: finite(resource.rssMiB), ...(resource.heapMiB === undefined ? {} : { heapMiB: finite(resource.heapMiB) }),
        }
      }),
    }
  }) : []
  const fairness = input.fairness && typeof input.fairness === 'object' ? input.fairness as Record<string, unknown> : null
  return {
    generatedAt: instant(input.generatedAt),
    window: { from: instant(window.from), to: instant(window.to), samplingIntervalMs: finite(window.samplingIntervalMs) },
    runs,
    fairness: fairness ? {
      users: finite(fairness.users), p50FirstEvidenceMs: finite(fairness.p50FirstEvidenceMs),
      p95FirstEvidenceMs: finite(fairness.p95FirstEvidenceMs), completionSpreadMs: finite(fairness.completionSpreadMs),
      starvedUsers: finite(fairness.starvedUsers),
      comparisons: (Array.isArray(fairness.comparisons) ? fairness.comparisons : []).slice(0, 10).map((candidate) => {
        const comparison = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
        return { userLabel: text(comparison.userLabel, 40), queueWaitMs: finite(comparison.queueWaitMs), firstEvidenceMs: finite(comparison.firstEvidenceMs), completionMs: finite(comparison.completionMs), progressPercent: Math.min(100, finite(comparison.progressPercent)) }
      }),
    } : null,
  }
}

export async function readLocalPerformanceDiagnostics(environment: NodeJS.ProcessEnv = process.env) {
  const file = environment.VOICE_LAB_PERFORMANCE_DIAGNOSTICS_FILE
  if (!file) return sanitizePerformanceDiagnostics({})
  const raw = await readFile(file, { encoding: 'utf8' })
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error('LOCAL_PERFORMANCE_DIAGNOSTICS_TOO_LARGE')
  return sanitizePerformanceDiagnostics(JSON.parse(raw))
}

const progressHighWater = new Map<string, number>()
const milliseconds = (from: unknown, to: unknown) => {
  const start = new Date(String(from)).getTime()
  const end = new Date(String(to)).getTime()
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)] || 0

export async function collectLocalPerformanceDiagnostics(
  targets: Array<{ database: Database; lane: 'authenticated' | 'demo' }>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const seed = await readLocalPerformanceDiagnostics(environment)
  let resourceWindow = seed.window
  let resourceSamples = seed.runs.flatMap((run) => run.resources)
  if (environment.VOICE_LAB_PERFORMANCE_RESOURCE_FILE) {
    try {
      const raw = await readFile(environment.VOICE_LAB_PERFORMANCE_RESOURCE_FILE, 'utf8')
      if (Buffer.byteLength(raw) > 1_000_000) throw new Error('LOCAL_PERFORMANCE_RESOURCES_TOO_LARGE')
      const parsed = JSON.parse(raw) as { from?: string; to?: string; intervalMs?: number; samples?: unknown[] }
      resourceWindow = { from: parsed.from || '', to: parsed.to || '', samplingIntervalMs: finite(parsed.intervalMs) }
      resourceSamples = sanitizePerformanceDiagnostics({ runs: [{ resources: parsed.samples }] }).runs[0]?.resources || []
    } catch {
      // The sampler is optional; live run and queue metrics remain available.
    }
  }

  const seeded = new Map(seed.runs.map((run) => [run.runId, run]))
  const runStarts = new Map<string, number>()
  const runs: ReturnType<typeof sanitizePerformanceDiagnostics>['runs'] = []
  for (const target of targets) {
    const recent = await target.database.query<{ id: string; status: string; stage: string; createdAt: string; completedAt: string | null }>(
      `SELECT id,status,stage,created_at AS "createdAt",completed_at AS "completedAt"
       FROM analysis_runs ORDER BY created_at DESC LIMIT 12`,
    )
    for (const run of recent.rows) {
      runStarts.set(run.id, new Date(run.createdAt).getTime())
      const jobs = await target.database.query<{
        total: number; queued: number; active: number; completed: number; retries: number
        longestQueueMs: number; firstEvidenceAt: string | null; lastCompletedAt: string | null; modelDurationMs: number
      }>(
        `SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE state IN ('queued','budget_wait','rate_wait','retry_wait'))::int AS queued,
          COUNT(*) FILTER (WHERE state IN ('leased','running'))::int AS active,
          COUNT(*) FILTER (WHERE state IN ('succeeded','fallback_completed','dead_lettered','cancelled'))::int AS completed,
          COALESCE(SUM(GREATEST(attempt_count - 1, 0)),0)::int AS retries,
          COALESCE(MAX(EXTRACT(EPOCH FROM (last_leased_at-created_at))*1000),0)::float AS "longestQueueMs",
          CASE WHEN COUNT(*) FILTER (WHERE kind LIKE 'emerging_signal_interpretation:%') > 0
                 AND COUNT(*) FILTER (WHERE kind LIKE 'emerging_signal_interpretation:%')
                   = COUNT(*) FILTER (WHERE kind LIKE 'emerging_signal_interpretation:%' AND state='succeeded')
            THEN MAX(completed_at) FILTER (WHERE kind LIKE 'emerging_signal_interpretation:%' AND state='succeeded')
            ELSE NULL END AS "firstEvidenceAt",
          MAX(completed_at) AS "lastCompletedAt",
          COALESCE(SUM(EXTRACT(EPOCH FROM (completed_at-last_leased_at))*1000) FILTER (WHERE completed_at IS NOT NULL AND last_leased_at IS NOT NULL),0)::float AS "modelDurationMs"
         FROM llm_jobs WHERE analysis_run_id=$1`, [run.id],
      )
      const counts = jobs.rows[0] || { total: 0, queued: 0, active: 0, completed: 0, retries: 0, longestQueueMs: 0, firstEvidenceAt: null, lastCompletedAt: null, modelDurationMs: 0 }
      const recentJobs = await target.database.query<{ id: string; state: string; createdAt: string; lastLeasedAt: string | null; completedAt: string | null; attemptCount: number; lastErrorCode: string | null; attemptModels: string[]; attemptErrorCodes: string[] }>(
        `SELECT j.id,j.state,j.created_at AS "createdAt",j.last_leased_at AS "lastLeasedAt",j.completed_at AS "completedAt",j.attempt_count AS "attemptCount",j.last_error_code AS "lastErrorCode",
          ARRAY(SELECT DISTINCT a.model FROM llm_attempts a WHERE a.job_id=j.id ORDER BY a.model) AS "attemptModels",
          ARRAY(SELECT DISTINCT a.error_code FROM llm_attempts a WHERE a.job_id=j.id AND a.error_code IS NOT NULL ORDER BY a.error_code) AS "attemptErrorCodes"
         FROM llm_jobs j WHERE j.analysis_run_id=$1 ORDER BY j.created_at DESC LIMIT 12`, [run.id],
      )
      const baseProgress = run.status === 'completed' ? 100 : run.stage === 'interpreting_clusters' && counts.total > 0
        ? 40 + Math.round((counts.completed / counts.total) * 55)
        : run.stage === 'preprocessing' ? 30 : run.stage === 'assembling_dataset' ? 15 : 5
      const progress = Math.max(progressHighWater.get(run.id) || 0, baseProgress)
      progressHighWater.set(run.id, progress)
      const stage = run.status === 'completed' ? 'Completed'
        : run.status === 'failed' ? 'Failed'
          : counts.active > 0 ? 'Interpreting'
            : counts.queued > 0 ? 'Waiting for intelligence capacity'
              : run.stage === 'interpreting_clusters' ? 'Building overview'
                : run.stage === 'preprocessing' ? 'Extracting evidence' : 'Preparing'
      const completedAt = run.completedAt || new Date().toISOString()
      const previous = seeded.get(run.id)
      runs.push({
        runId: run.id, lane: target.lane, userLabel: `${target.lane === 'demo' ? 'demo' : 'user'}-${runs.length + 1}`,
        stage, progressPercent: progress,
        timings: {
          parseValidateMs: previous?.timings.parseValidateMs || 0, csvSaveMs: previous?.timings.csvSaveMs || 0,
          queueWaitMs: counts.longestQueueMs, firstEvidenceMs: counts.firstEvidenceAt ? milliseconds(run.createdAt, counts.firstEvidenceAt) : 0,
          completionMs: milliseconds(run.createdAt, completedAt),
          aggregationPersistMs: run.completedAt && counts.lastCompletedAt ? milliseconds(counts.lastCompletedAt, run.completedAt) : 0,
        },
        queue: {
          queued: counts.queued, active: counts.active,
          leaseState: counts.active > 0 ? 'Intelligence requests running' : counts.queued > 0 ? 'Waiting for intelligence capacity' : run.status === 'completed' ? 'Completed without an active lease' : 'Preparing intelligence work',
        },
        llm: { requests: counts.total, retries: counts.retries, durationMs: counts.modelDurationMs },
        jobs: recentJobs.rows.map((job) => {
          const terminal = ['succeeded', 'fallback_completed', 'dead_lettered', 'cancelled'].includes(job.state)
          const running = ['leased', 'running'].includes(job.state)
          const status = job.state === 'succeeded' ? 'Completed' : job.state === 'fallback_completed' ? 'Completed with fallback'
            : job.state === 'dead_lettered' ? 'Stopped after retries' : job.state === 'cancelled' ? 'Cancelled'
              : running ? 'Running intelligence' : job.state === 'retry_wait' ? 'Waiting to retry' : 'Waiting for intelligence capacity'
          return {
            jobId: job.id, status, queueWaitMs: job.lastLeasedAt ? milliseconds(job.createdAt, job.lastLeasedAt) : milliseconds(job.createdAt, new Date().toISOString()),
            progressPercent: terminal ? 100 : running ? 50 : 0, retries: Math.max(0, job.attemptCount - 1), elapsedMs: milliseconds(job.createdAt, job.completedAt || new Date().toISOString()), errorCode: job.lastErrorCode || '', attemptModels: job.attemptModels, attemptErrorCodes: job.attemptErrorCodes,
          }
        }),
        resources: resourceSamples.filter((sample) => !sample.sampledAt || (new Date(sample.sampledAt).getTime() >= new Date(run.createdAt).getTime() && new Date(sample.sampledAt).getTime() <= new Date(completedAt).getTime())).slice(-100),
      })
    }
  }
  const measuredRuns = runs.filter((run) => runStarts.has(run.runId))
  let measured: typeof measuredRuns = []
  for (const candidate of measuredRuns) {
    const started = runStarts.get(candidate.runId) || 0
    const cohort = measuredRuns.filter((run) => Math.abs((runStarts.get(run.runId) || 0) - started) <= 5_000).slice(0, 3)
    if (cohort.length === 3) { measured = cohort; break }
  }
  const firstEvidence = measured.map((run) => run.timings.firstEvidenceMs).filter((duration) => duration > 0)
  const completion = measured.map((run) => run.timings.completionMs)
  return sanitizePerformanceDiagnostics({
    generatedAt: new Date().toISOString(), window: resourceWindow, runs: [...runs, ...seed.runs.filter((run) => !runs.some((live) => live.runId === run.runId))],
    fairness: measured.length === 3 ? {
      users: 3, p50FirstEvidenceMs: percentile(firstEvidence, .5), p95FirstEvidenceMs: percentile(firstEvidence, .95),
      completionSpreadMs: Math.max(...completion) - Math.min(...completion), starvedUsers: measured.filter((run) => run.progressPercent === 100 && run.timings.firstEvidenceMs === 0).length,
      comparisons: measured.map((run) => ({ userLabel: run.userLabel, queueWaitMs: run.timings.queueWaitMs, firstEvidenceMs: run.timings.firstEvidenceMs, completionMs: run.timings.completionMs, progressPercent: run.progressPercent })),
    } : null,
  })
}
