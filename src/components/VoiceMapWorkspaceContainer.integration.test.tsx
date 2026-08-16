import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceMapWorkspaceContainer } from './VoiceMapWorkspaceContainer'
import { listAnalysisRuns } from '../lib/api'

vi.mock('../lib/api', async (loadOriginal) => ({
  ...await loadOriginal<typeof import('../lib/api')>(),
  listAnalysisRuns: vi.fn(),
}))

describe('Voice Map saved-result loading', () => {
  beforeEach(() => vi.mocked(listAnalysisRuns).mockReset().mockResolvedValue([]))

  it('loads once per project and does not refetch for local section or date projection changes', async () => {
    const props = { projectId: 'project-1', onOpenReview: vi.fn(), onOpenCuration: vi.fn() }
    const { rerender } = render(<VoiceMapWorkspaceContainer {...props} section="overview" />)
    await waitFor(() => expect(listAnalysisRuns).toHaveBeenCalledTimes(1))

    rerender(<VoiceMapWorkspaceContainer {...props} section="voice-map" dateRange={{ from: '2026-03-01', to: '2026-03-31' }} />)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listAnalysisRuns).toHaveBeenCalledTimes(1)
  })
})
