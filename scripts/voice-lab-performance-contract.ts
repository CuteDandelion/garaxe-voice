export type PerformanceStage =
  | 'csv_acknowledged'
  | 'csv_persisted'
  | 'analysis_queue_wait'
  | 'first_grounded_evidence'
  | 'analysis_completed'
  | 'date_range_applied'
  | 'overview_ready'
  | 'voice_map_ready'

export type PerformanceSample = {
  workload: number
  temperature: 'cold' | 'warm'
  stage: PerformanceStage
  milliseconds: number
  createdAnalysisRuns?: number
  createdLlmJobs?: number
  equivalenceFingerprint: string
}

export const PERFORMANCE_TARGETS_MS = {
  csv_acknowledged: 2_000,
  date_range_applied: 1_000,
  overview_ready: 1_000,
  voice_map_ready: 1_000,
  first_grounded_evidence_50: 10_000,
} as const

function percentile(values: number[], ratio: number) {
  if (values.length === 0) throw new Error('PERFORMANCE_SAMPLES_REQUIRED')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * ratio) - 1]
}

export function summarizePerformance(samples: PerformanceSample[]) {
  const groups = new Map<string, PerformanceSample[]>()
  for (const sample of samples) {
    if (!Number.isFinite(sample.milliseconds) || sample.milliseconds < 0) throw new Error('INVALID_PERFORMANCE_SAMPLE')
    const key = `${sample.workload}:${sample.temperature}:${sample.stage}`
    groups.set(key, [...(groups.get(key) || []), sample])
  }
  return [...groups.entries()].map(([key, group]) => {
    const [workload, temperature, stage] = key.split(':')
    return {
      workload: Number(workload),
      temperature: temperature as PerformanceSample['temperature'],
      stage: stage as PerformanceStage,
      samples: group.length,
      p50Ms: percentile(group.map((sample) => sample.milliseconds), .5),
      p95Ms: percentile(group.map((sample) => sample.milliseconds), .95),
      createdAnalysisRuns: group.reduce((total, sample) => total + (sample.createdAnalysisRuns || 0), 0),
      createdLlmJobs: group.reduce((total, sample) => total + (sample.createdLlmJobs || 0), 0),
      fingerprints: [...new Set(group.map((sample) => sample.equivalenceFingerprint))],
    }
  })
}

export function evaluatePerformance(samples: PerformanceSample[], baselineFingerprint: string) {
  const summaries = summarizePerformance(samples)
  const failures: string[] = []
  for (const summary of summaries) {
    if (summary.fingerprints.length !== 1 || summary.fingerprints[0] !== baselineFingerprint) failures.push(`${summary.workload}/${summary.temperature}/${summary.stage}: equivalence changed`)
    const target = summary.stage === 'first_grounded_evidence' && summary.workload === 50
      ? PERFORMANCE_TARGETS_MS.first_grounded_evidence_50
      : PERFORMANCE_TARGETS_MS[summary.stage as keyof Omit<typeof PERFORMANCE_TARGETS_MS, 'first_grounded_evidence_50'>]
    if (target !== undefined && summary.p95Ms > target) failures.push(`${summary.workload}/${summary.temperature}/${summary.stage}: p95 ${summary.p95Ms}ms > ${target}ms`)
    if (summary.stage === 'date_range_applied' && (summary.createdAnalysisRuns !== 0 || summary.createdLlmJobs !== 0)) failures.push(`${summary.workload}/${summary.temperature}/${summary.stage}: launched analysis or LLM work`)
  }
  return { pass: failures.length === 0, failures, summaries }
}
