import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisWorkspace, type AnalysisWorkspaceProps } from './AnalysisWorkspace'

function processingProps(): AnalysisWorkspaceProps {
  return {
    status: 'processing',
    config: {
      objective: 'full_voice_map', dateFrom: '', dateTo: '', entityIds: [], ratings: [], languages: [],
      writtenOnly: true, minimumTextLength: 12,
    },
    entityOptions: [], languageOptions: [], preview: null,
    stages: [
      { key: 'assembling_dataset', label: 'Assembling the immutable dataset', state: 'complete' },
      { key: 'interpreting_clusters', label: 'Interpreting every cluster with Voice Map intelligence', state: 'active' },
      { key: 'completed', label: 'Preparing the evidence-backed Voice Map', state: 'pending' },
    ],
    llmProgress: {
      total: 18, queued: 3, waiting: 7, inFlight: 2, succeeded: 5, fallback: 1, failed: 0,
      completed: 6, remaining: 12, percent: 33, validatedThemes: 63, interpretedThemes: 19,
      coverage: 19 / 63, provider: 'opencode_go', model: 'qwen3.7-plus', updatedAt: '2026-07-13T13:00:00Z',
    },
    activeRunId: '510f63e5-d74a-4261-bbe3-1e04d015b980',
    activeRunStartedAt: new Date(Date.now() - 75_000).toISOString(),
    onConfigChange: vi.fn(), onRun: vi.fn(),
  }
}

describe('AnalysisWorkspace processing progress', () => {
  it('explains that another source is included by a new immutable project run', () => {
    render(<AnalysisWorkspace {...processingProps()} status="configure" preview={{ found: 20, eligible: 20, excluded: 0 }} />)

    expect(screen.getByText(/A new run uses all current project feedback that matches these filters/i)).toBeInTheDocument()
    expect(screen.getByText(/Earlier runs and reports stay unchanged/i)).toBeInTheDocument()
  })

  it('shows customer-facing progress without worker or run internals', () => {
    render(<AnalysisWorkspace {...processingProps()} />)
    expect(screen.getByRole('progressbar', { name: 'Analysis progress: 33%' })).toHaveAttribute('aria-valuenow', '33')
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText(/Some feedback needed an alternate analysis pass/i)).toBeInTheDocument()
    expect(screen.queryByText(/jobs complete|active \/ waiting|interpreted themes|run 510f63e5|governed fallback|qwen|LLM|opencode/i)).not.toBeInTheDocument()
  })

  it('never moves visible analysis progress backwards when later work is discovered', () => {
    const props = processingProps()
    const { rerender } = render(<AnalysisWorkspace {...props} llmProgress={{ ...props.llmProgress!, percent: 83 }} />)

    rerender(<AnalysisWorkspace {...props} llmProgress={{ ...props.llmProgress!, total: 30, completed: 14, remaining: 16, percent: 47 }} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '83')
    expect(screen.getByText('83%')).toBeInTheDocument()
  })

  it('does not describe failed jobs as governed fallback', () => {
    const props = processingProps()
    render(<AnalysisWorkspace {...props} llmProgress={{ ...props.llmProgress!, fallback: 0, failed: 1 }} />)
    expect(screen.getByText(/The run will not publish an incomplete map/i)).toBeInTheDocument()
    expect(screen.queryByText(/job failed|governed fallback/i)).not.toBeInTheDocument()
  })

  it('reports semantic cluster coverage and honest outliers after completion', () => {
    const props = processingProps()
    const onOpenOverview = vi.fn()
    render(<AnalysisWorkspace {...props} status="completed" report={{
      runId: 'run-semantic', createdAt: '2026-07-13', configurationVersion: 'preprocessing-v1', pipelineVersion: 'semantic-voice-map-v5',
      found: 100, included: 100, excluded: 0, written: 100, ratingOnly: 0, averageTextLength: 80, medianTextLength: 72,
      duplicateGroups: 0, confidence: 'Moderate', exclusionReasons: [], languages: [{ language: 'en', count: 100 }], membership: [],
      semanticAnalysis: {
        pipelineVersion: 'semantic-cluster-pipeline-v4', clusteringVersion: 'mutual-knn-cluster-v1', segmentCount: 140,
        clusterCount: 18, clusteredSegmentCount: 116, outlierCount: 24, ambiguousSegmentCount: 3, similarityThreshold: .90,
      },
    }} onOpenOverview={onOpenOverview} />)
    expect(screen.getByText('18', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('116 / 140')).toBeInTheDocument()
    expect(screen.getByText('24', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.queryByText(/run-semantic|preprocessing-v1|semantic-voice-map-v5|mutual-knn-cluster-v1|similarity floor/i)).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Open Overview' }).click()
    expect(onOpenOverview).toHaveBeenCalledOnce()
  })
})
