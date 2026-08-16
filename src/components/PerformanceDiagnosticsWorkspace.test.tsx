import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PerformanceDiagnosticsWorkspace } from './PerformanceDiagnosticsWorkspace'
import { getLocalPerformanceDiagnostics, type LocalPerformanceDiagnostics } from '../lib/api'

vi.mock('../lib/api', () => ({ getLocalPerformanceDiagnostics: vi.fn() }))

describe('local performance diagnostics workspace', () => {
  const report: LocalPerformanceDiagnostics = {
    generatedAt: '2026-08-14T12:00:00.000Z',
    window: { from: '2026-08-14T11:50:00.000Z', to: '2026-08-14T12:00:00.000Z', samplingIntervalMs: 2_000 },
    runs: [{
      runId: '11111111-1111-4111-8111-111111111111', lane: 'authenticated', userLabel: 'user-1', stage: 'Interpreting', progressPercent: 72,
      timings: { parseValidateMs: 12, csvSaveMs: 140, queueWaitMs: 500, firstEvidenceMs: 9_000, completionMs: 20_000, aggregationPersistMs: 200 },
      queue: { queued: 2, active: 1, leaseState: 'Waiting for intelligence capacity' },
      llm: { requests: 10, retries: 0, durationMs: 18_000 },
      jobs: [{ jobId: 'job-1', status: 'Running intelligence', queueWaitMs: 500, progressPercent: 50, retries: 0, elapsedMs: 4_000 }],
      resources: [{ sampledAt: '2026-08-14T11:55:00.000Z', service: 'api', cpuPercent: 12.5, rssMiB: 380, heapMiB: 120 }, { sampledAt: '2026-08-14T11:55:00.000Z', service: 'api', cpuPercent: 12.5, rssMiB: 380, heapMiB: 120 }],
    }],
    fairness: { users: 3, p50FirstEvidenceMs: 10_000, p95FirstEvidenceMs: 12_000, completionSpreadMs: 2_000, starvedUsers: 0, comparisons: [{ userLabel: 'user-1', queueWaitMs: 500, firstEvidenceMs: 9_000, completionMs: 20_000, progressPercent: 100 }] },
  }
  beforeEach(() => {
    vi.mocked(getLocalPerformanceDiagnostics).mockResolvedValue(report)
  })

  it('shows run timing, queue, model, resource, and fairness evidence without customer content', async () => {
    render(<PerformanceDiagnosticsWorkspace />)
    expect(await screen.findByRole('heading', { name: 'Performance diagnostics' })).toBeInTheDocument()
    expect(screen.getByText('Fully covered evidence p95')).toBeInTheDocument()
    expect(screen.getByText('Waiting for intelligence capacity')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Recent analysis runs' })).toHaveTextContent('10 requests · 18.0s')
    expect(screen.getByRole('row', { name: /api 12.5% 380 MiB/ })).toBeInTheDocument()
    expect(screen.getByText('3 users · 0 starved')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Active and recent intelligence jobs' })).toHaveTextContent('Running intelligence')
    expect(screen.getByRole('table', { name: 'Three-user fairness comparison' })).toHaveTextContent('user-1')
    expect(screen.getByRole('table', { name: 'Recent analysis runs' })).toHaveTextContent('Interpreting')
    expect(screen.getByRole('img', { name: 'CPU over time' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Memory over time' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Measured stage duration for user-1' })).toHaveTextContent('Model work')
    const cpuPoint = screen.getByLabelText(/^CPU, .*: 12.5%$/)
    fireEvent.focus(cpuPoint)
    expect(screen.getAllByLabelText('Chart value').find((item) => item.textContent?.includes('12.5%'))).toBeTruthy()
    expect(screen.getByText('Waiting for a second live queue sample.')).toBeInTheDocument()
    expect(screen.queryByText(/feedback|comment|quote/i)).not.toBeInTheDocument()
  })

  it('bounds the job ledger and keeps workspace/run context', async () => {
    vi.mocked(getLocalPerformanceDiagnostics).mockResolvedValue({
      ...report,
      runs: report.runs.map((run) => ({ ...run, jobs: [
        ...Array.from({ length: 8 }, (_, index) => ({ jobId: `active-${index}`, status: 'Waiting for intelligence capacity', queueWaitMs: 500, progressPercent: 0, retries: 0, elapsedMs: 4_000 })),
        ...Array.from({ length: 7 }, (_, index) => ({ jobId: `done-${index}`, status: 'Completed', queueWaitMs: 500, progressPercent: 100, retries: 0, elapsedMs: 4_000 })),
      ] })),
    })
    render(<PerformanceDiagnosticsWorkspace />)
    const table = await screen.findByRole('table', { name: 'Active and recent intelligence jobs' })
    expect(within(table).getAllByRole('row')).toHaveLength(10)
    expect(within(table).getAllByText('user-1').length).toBeGreaterThan(0)
    expect(screen.getByText('Showing 6 of 8 active jobs and 3 recent completions.')).toBeInTheDocument()
  })

  it('polls bounded live updates while mounted', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalPerformanceDiagnostics)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, runs: report.runs.map((run) => ({ ...run, stage: 'Building overview', progressPercent: 91 })) })
    render(<PerformanceDiagnosticsWorkspace />)
    await act(async () => {})
    expect(screen.getByText('Interpreting')).toBeInTheDocument()
    expect(document.querySelector('.performance-diagnostics__table-progress i')).toHaveStyle({ width: '72%' })
    const initialCalls = vi.mocked(getLocalPerformanceDiagnostics).mock.calls.length
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(screen.getByText('Building overview')).toBeInTheDocument()
    expect(document.querySelector('.performance-diagnostics__table-progress i')).toHaveStyle({ width: '91%' })
    expect(getLocalPerformanceDiagnostics).toHaveBeenCalledTimes(initialCalls + 1)
    vi.useRealTimers()
  })

  it('pauses only dashboard refresh and resumes with a fresh snapshot', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalPerformanceDiagnostics)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, generatedAt: '2026-08-14T12:01:00.000Z' })
    render(<PerformanceDiagnosticsWorkspace />)
    await act(async () => {})
    const callsAtPause = vi.mocked(getLocalPerformanceDiagnostics).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Pause updates' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Updates paused.*Analysis continues in the background/i)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(getLocalPerformanceDiagnostics).toHaveBeenCalledTimes(callsAtPause)
    fireEvent.click(screen.getByRole('button', { name: 'Resume updates' }))
    await act(async () => {})
    expect(getLocalPerformanceDiagnostics).toHaveBeenCalledTimes(callsAtPause + 1)
    expect(screen.getByRole('button', { name: 'Pause updates' })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
