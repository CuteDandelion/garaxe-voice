import { describe, expect, it } from 'vitest'
import { evaluatePerformance, summarizePerformance, type PerformanceSample } from './voice-lab-performance-contract'

const sample = (overrides: Partial<PerformanceSample> = {}): PerformanceSample => ({
  workload: 50,
  temperature: 'cold',
  stage: 'csv_acknowledged',
  milliseconds: 100,
  equivalenceFingerprint: 'same-grounded-result',
  ...overrides,
})

describe('Voice Lab measurable performance contract', () => {
  it('reports cold and warm p50/p95 per workload and stage', () => {
    const summaries = summarizePerformance([100, 200, 300, 400, 500].map((milliseconds) => sample({ milliseconds })))
    expect(summaries).toEqual([expect.objectContaining({ workload: 50, temperature: 'cold', stage: 'csv_acknowledged', samples: 5, p50Ms: 300, p95Ms: 500 })])
  })

  it('rejects faster results that change evidence or grounded intelligence inputs', () => {
    const result = evaluatePerformance([
      sample({ stage: 'overview_ready', milliseconds: 20 }),
      sample({ stage: 'voice_map_ready', milliseconds: 20, equivalenceFingerprint: 'dropped-evidence' }),
    ], 'same-grounded-result')
    expect(result.pass).toBe(false)
    expect(result.failures).toContain('50/cold/voice_map_ready: equivalence changed')
  })

  it('requires date projection to stay below one second without analysis or LLM jobs', () => {
    const result = evaluatePerformance([
      sample({ stage: 'date_range_applied', milliseconds: 1_001, createdAnalysisRuns: 1, createdLlmJobs: 3 }),
    ], 'same-grounded-result')
    expect(result.pass).toBe(false)
    expect(result.failures).toEqual([
      '50/cold/date_range_applied: p95 1001ms > 1000ms',
      '50/cold/date_range_applied: launched analysis or LLM work',
    ])
  })

  it('keeps full-analysis timing reportable without using it as a usable-evidence blocker', () => {
    const result = evaluatePerformance([
      sample({ stage: 'first_grounded_evidence', milliseconds: 9_999 }),
      sample({ stage: 'analysis_completed', milliseconds: 600_000 }),
    ], 'same-grounded-result')
    expect(result.pass).toBe(true)
    expect(result.summaries.find((entry) => entry.stage === 'analysis_completed')?.p95Ms).toBe(600_000)
  })
})
