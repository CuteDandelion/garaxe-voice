import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DemoCooldown, PublicDemo, PublicLanding } from './PublicLanding'
import { rowsToCsv, sampleCsv } from '../lib/csv'

async function submitDemoCsv(rawCsv = sampleCsv, fileName = 'demo.csv') {
  const file = new File([rawCsv], fileName, { type: 'text/csv' })
  if (!file.text) Object.defineProperty(file, 'text', { value: async () => rawCsv })
  fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with CSV' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Continue with CSV' }))
}

describe('PublicLanding', () => {
  it('shows a completed Demo map while its optional intelligence brief is still loading', async () => {
    const token = 'b'.repeat(43)
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/demo/analysis-runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { token, status: 'queued', expiresAt: '2026-08-14T10:00:00Z' } }), { status: 202 })
      }
      if (path === `/api/demo/analysis-runs/${token}`) {
        return new Response(JSON.stringify({ data: {
          status: 'completed', stage: 'completed', demo: true,
          themes: [{ id: 'theme-1', name: 'Visible progress', summary: 'Customers need progress updates.', type: 'pain', confidence: 'high', evidence: [{ reviewId: 'review-1', quote: 'Tell me what happens next.', originalText: 'Tell me what happens next.', provider: 'csv_import', sourceCreatedAt: '2026-08-01T00:00:00Z' }] }],
          coverage: [{ reviewId: 'review-1', originalText: 'Tell me what happens next.', disposition: 'recurring', reason: 'Grounded signal.', themeIds: ['theme-1'], signals: [] }],
        } }), { status: 200 })
      }
      if (path === `/api/demo/analysis-runs/${token}/overview`) return new Promise<Response>(() => {})
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv()

    expect(await screen.findByRole('button', { name: 'Overview' })).toHaveClass('active')
    expect(screen.getByText('Preparing the intelligence brief…')).toBeInTheDocument()
  })

  it('filters a completed Demo result by date without starting another analysis', async () => {
    const token = 'd'.repeat(43)
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/demo/analysis-runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { token, status: 'queued', expiresAt: '2026-08-14T10:00:00Z' } }), { status: 202 })
      }
      if (path === `/api/demo/analysis-runs/${token}`) {
        return new Response(JSON.stringify({ data: {
          status: 'completed', stage: 'completed', demo: true,
          themes: [{ id: 'theme-1', name: 'Clear updates', summary: 'Customers need timely updates.', type: 'pain', confidence: 'high', evidence: [
            { reviewId: 'review-1', quote: 'The first update arrived late.', originalText: 'The first update arrived late.', sourceCreatedAt: '2026-08-03T00:00:00Z' },
            { reviewId: 'review-2', quote: 'The second update was clear.', originalText: 'The second update was clear.', sourceCreatedAt: '2026-08-10T00:00:00Z' },
          ] }],
          coverage: [
            { reviewId: 'review-1', originalText: 'The first update arrived late.', source: { provider: 'csv_upload', entity: null, rating: 2, ratingScale: 5, language: 'en', sourceCreatedAt: '2026-08-03T00:00:00Z', sourceUrl: null }, disposition: 'recurring', reason: 'Grounded signal.', themeIds: ['theme-1'], signals: [] },
            { reviewId: 'review-2', originalText: 'The second update was clear.', source: { provider: 'csv_upload', entity: null, rating: 4, ratingScale: 5, language: 'en', sourceCreatedAt: '2026-08-10T00:00:00Z', sourceUrl: null }, disposition: 'recurring', reason: 'Grounded signal.', themeIds: ['theme-1'], signals: [] },
          ],
        } }), { status: 200 })
      }
      if (path === `/api/demo/analysis-runs/${token}/overview`) {
        return new Response(JSON.stringify({ data: { status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null } }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv()
    await screen.findByRole('button', { name: 'Overview' })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const requestsBeforeFilter = vi.mocked(fetch).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Filter review period Aug 2026 – Aug 2026' }))
    fireEvent.input(screen.getByLabelText('From'), { target: { value: '2026-08-03' } })
    fireEvent.input(screen.getByLabelText('To'), { target: { value: '2026-08-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }))

    expect(await screen.findByRole('img', { name: 'Uploaded CSV: 1 feedback, 100%' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aug 10, 2026 — Clear updates/ })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(requestsBeforeFilter)
  })

  it('renders the server cooldown as a live countdown and offers a fresh demo at zero', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z'))
    const onStartNewDemo = vi.fn()
    render(<DemoCooldown resetAt="2026-08-13T12:00:02Z" onCheckReady={async () => true} onStartNewDemo={onStartNewDemo} />)

    expect(screen.getByRole('timer')).toHaveTextContent('Available again in 00:00:02')
    expect(screen.queryByRole('button', { name: 'Start a new demo' })).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Start a new demo' }))
    expect(onStartNewDemo).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not invent a timeout while the saved Demo run is still active', async () => {
    const token = 't'.repeat(43)
    let statusCalls = 0
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/demo/analysis-runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { token, status: 'queued', expiresAt: '2026-08-14T10:00:00Z' } }), { status: 202 })
      }
      if (String(input) === `/api/demo/analysis-runs/${token}`) {
        statusCalls += 1
        if (statusCalls <= 300) return new Response(JSON.stringify({ data: { status: 'interpreting_clusters', stage: 'interpreting_clusters', demo: true } }), { status: 200 })
        return new Response(JSON.stringify({ data: { status: 'completed', stage: 'completed', demo: true, themes: [], coverage: [] } }), { status: 200 })
      }
      if (String(input) === `/api/demo/analysis-runs/${token}/overview`) {
        return new Response(JSON.stringify({ data: { status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null } }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    const file = new File([sampleCsv], 'demo.csv', { type: 'text/csv' })
    if (!file.text) Object.defineProperty(file, 'text', { value: async () => sampleCsv })
    fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with CSV' })).toBeEnabled())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with CSV' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(301_000) })
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active')
    expect(statusCalls).toBe(301)
    expect(screen.queryByText(/still running\. Start a fresh demo/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })
  it('keeps every public destination on one anchored homepage and omits undecided pricing', () => {
    render(<PublicLanding onLogin={vi.fn()} onDemo={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Voice Lab home' })).toHaveTextContent('Voice Lab')
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    for (const [label, href] of [['Product', '#product'], ['Examples', '#examples'], ['Resources', '#resources'], ['About', '#about']]) {
      expect(within(navigation).getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
    expect(screen.queryByRole('link', { name: /pricing/i })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/pricing/i)
    expect(screen.getByRole('heading', { name: /Turn scattered feedback into evidence/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Voice Lab product preview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How Voice Lab turns feedback into trusted output' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'See the evidence trail, not a black box' })).toBeInTheDocument()
    expect(screen.getByLabelText('Voice Lab product walkthrough')).toBeInTheDocument()
    expect(screen.getByText(/authenticated workspace walkthrough/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The operating rules behind trusted output' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Built for decisions that need a source trail' })).toBeInTheDocument()
    for (const id of ['product', 'examples', 'resources', 'about']) expect(document.getElementById(id)).toBeInTheDocument()
    expect(screen.getByText(/Every conclusion stays linked to the exact customer words/i)).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Trusted output')
    expect(screen.getByText('About · Voice Lab by Elseform')).toBeInTheDocument()
    expect(footer).toHaveTextContent('Voice Lab by Elseform')
    expect(within(footer).getByRole('link', { name: 'voicelab.elseform.tech' })).toHaveAttribute('href', 'https://voicelab.elseform.tech')
    expect(screen.getByRole('link', { name: 'Join waitlist' })).toHaveAttribute('href', 'mailto:hello@elseform.tech?subject=Voice%20Lab%20waitlist')
    expect(document.body).not.toHaveTextContent(/Garaxe|misakirose/i)
    for (const label of ['Product', 'Examples', 'Resources', 'About']) expect(within(footer).getByRole('link', { name: label })).toBeInTheDocument()
    expect(navigation).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses real, user-controlled product recordings instead of mock previews', () => {
    render(<PublicLanding onLogin={vi.fn()} onDemo={vi.fn()} />)

    const heroPreview = screen.getByLabelText('Voice Lab product preview') as HTMLVideoElement
    const walkthrough = screen.getByLabelText('Voice Lab product walkthrough') as HTMLVideoElement
    expect(heroPreview).toHaveAttribute('src', '/voice-lab-hero-preview.mp4')
    expect(walkthrough).toHaveAttribute('src', '/voice-lab-walkthrough.mp4')
    for (const video of [heroPreview, walkthrough]) {
      expect(video).toHaveAttribute('controls')
      expect(video).not.toHaveAttribute('autoplay')
      expect(video).toHaveAttribute('playsinline')
      expect(video.muted).toBe(true)
      expect(video).toHaveAttribute('preload', 'metadata')
      expect(video).toHaveAttribute('poster', '/voice-lab-walkthrough-poster.jpg')
    }
    expect(heroPreview).toHaveAttribute('loop')
    expect(walkthrough).not.toHaveAttribute('loop')
    expect(document.querySelector('.public-hero-preview')).not.toBeInTheDocument()
    expect(document.querySelector('.public-overview-sample')).not.toBeInTheDocument()
  })

  it('plays product recordings only while they are visible', () => {
    const callbacks: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
      observe() {}
      disconnect() {}
    })
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    render(<PublicLanding onLogin={vi.fn()} onDemo={vi.fn()} />)

    const heroPreview = screen.getByLabelText('Voice Lab product preview') as HTMLVideoElement
    callbacks[0]([{ isIntersecting: true, intersectionRatio: .8, target: heroPreview } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(play).toHaveBeenCalledOnce()
    callbacks[0]([{ isIntersecting: false, intersectionRatio: 0, target: heroPreview } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(pause).toHaveBeenCalledOnce()
  })

  it('shows the product recording poster without motion when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    render(<PublicLanding onLogin={vi.fn()} onDemo={vi.fn()} />)

    expect(screen.getByLabelText('Voice Lab product preview')).not.toHaveAttribute('autoplay')
    expect(screen.getByLabelText('Voice Lab product walkthrough')).not.toHaveAttribute('autoplay')
    expect(play).not.toHaveBeenCalled()
  })

  it('opens the isolated live-demo boundary', () => {
    const onDemo = vi.fn()
    render(<PublicLanding onLogin={vi.fn()} onDemo={onDemo} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Try the demo' })[0])
    expect(onDemo).toHaveBeenCalledOnce()
  })

  it('uses the one shared dashboard header for the Demo home path', () => {
    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    const headers = screen.getAllByRole('banner')
    expect(headers).toHaveLength(1)
    expect(within(headers[0]).getByRole('link', { name: 'Voice Lab home' })).toBeInTheDocument()
  })

  it('explains that Demo imports accumulate only inside the expiring workspace', () => {
    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Analyze up to 50 feedback records.' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('50 records max')
    expect(screen.getByRole('region', { name: 'Upload and analysis flow' })).toHaveTextContent('Upload & mapAnalyzeReady')
    expect(screen.getByText(/CSV can contain more rows/i)).toHaveTextContent(/first 50 eligible unique records/i)
    expect(screen.getByText(/CSV can contain more rows/i)).toHaveTextContent(/additional CSVs append/i)
  })

  it('adds a second CSV to the same bounded Demo workspace and shows the exhaustion cooldown', async () => {
    const token = 'i'.repeat(43)
    const csv = (start: number, count: number) => rowsToCsv([['review_id', 'source', 'review_text', 'review_date'], ...Array.from({ length: count }, (_, index) => [
      `incremental-${start + index}`, start === 1 ? 'Initial source' : 'Follow-up source',
      `Customer feedback ${start + index} contains enough distinct detail for the Voice Lab analysis.`,
      start === 1 ? '2026-01-10' : '2026-02-10',
    ])])
    let appended = false
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = String(input)
      if (path === '/api/demo/analysis-runs' && init?.method === 'POST') return new Response(JSON.stringify({ data: { token, status: 'queued', expiresAt: '2026-08-14T10:00:00Z', quota: { remaining: 40, resetAt: null } } }), { status: 202 })
      if (path === `/api/demo/analysis-runs/${token}/imports` && init?.method === 'POST') {
        appended = true
        return new Response(JSON.stringify({ data: { token, status: 'queued', addedRecords: 40, notImportedRecords: 1, expiresAt: '2026-08-14T10:00:00Z', quota: { remaining: 0, resetAt: '2026-08-14T17:00:00Z' } } }), { status: 202 })
      }
      if (path === `/api/demo/analysis-runs/${token}/overview`) return new Response(JSON.stringify({ data: { status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null } }), { status: 200 })
      if (path === `/api/demo/analysis-runs/${token}`) {
        const count = appended ? 50 : 10
        return new Response(JSON.stringify({ data: {
          status: 'completed', stage: 'completed', demo: true, expiresAt: '2026-08-14T10:00:00Z', pdfUrl: `/api/demo/analysis-runs/${token}/pdf`, quota: appended ? { remaining: 0, resetAt: '2026-08-14T17:00:00Z' } : { remaining: 40, resetAt: null },
          themes: [], coverage: Array.from({ length: count }, (_, index) => ({ reviewId: `review-${index + 1}`, originalText: `Feedback ${index + 1}`, disposition: 'emerging', reason: 'Grounded signal.', themeIds: [], signals: [] })),
        } }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv(csv(1, 10), 'initial.csv')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active'))
    fireEvent.click(screen.getByRole('button', { name: 'Analysis' }))
    expect(screen.getByRole('heading', { name: /add up to 40 more feedback records/i })).toBeInTheDocument()
    expect(screen.getByText(/40 comments remain/i)).toBeInTheDocument()
    await submitDemoCsv(csv(11, 41), 'follow-up.csv')

    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Project navigation' })).toHaveTextContent('50'))
    expect(screen.getByText('40 records imported. 1 record was not imported because the Demo allowance was reached.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/demo/analysis-runs/${token}/imports`, expect.objectContaining({ method: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analysis' }))
    expect(screen.getByRole('heading', { name: 'Demo upload allowance used.' })).toBeInTheDocument()
    expect(screen.getByText('Demo upload limit reached.').closest('[role="status"]')).toHaveTextContent(/Demo upload limit reached/i)
    expect(screen.getByRole('timer')).toHaveTextContent(/Available again in \d{2}:\d{2}:\d{2}/i)
    expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument()
  })

  it('keeps provider identity off every public demo surface', () => {
    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    expect(document.body).not.toHaveTextContent(/OpenCode|provider/i)
    expect(document.body).toHaveTextContent('Upload & map')
  })

  it('exposes the complete public navigation through an accessible mobile menu', () => {
    render(<PublicLanding onLogin={vi.fn()} onDemo={vi.fn()} />)
    const menu = screen.getByLabelText('Open navigation')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' })
    for (const label of ['Product', 'Examples', 'Resources', 'About']) {
      expect(mobileNavigation).toHaveTextContent(label)
    }
    expect(mobileNavigation).not.toHaveTextContent(/pricing/i)
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Try the demo' }).length).toBeGreaterThan(0)
  })

  it('shows a downloadable report only after the same-engine demo completes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        token: 'a'.repeat(43), status: 'queued', expiresAt: '2026-08-11T10:00:00.000Z', retentionHours: 24,
      } }), { status: 202, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        status: 'completed', demo: true, engine: 'llm-interpreted-theme-engine-v1', expiresAt: '2026-08-11T10:00:00.000Z',
        pdfUrl: `/api/demo/analysis-runs/${'a'.repeat(43)}/pdf`,
        themes: [{ id: 'theme-1', name: 'Visible progress', summary: 'Customers need progress updates.', type: 'pain', confidence: 'high', evidence: [
          { reviewId: 'review-1', quote: 'I had to ask three times what happened next.', entity: 'Sample Berlin', rating: 2, sourceCreatedAt: '2026-08-01T00:00:00.000Z' },
          { reviewId: 'review-2', quote: 'The next update arrived a day later.', entity: 'Sample Berlin', rating: 3, sourceCreatedAt: '2026-08-02T00:00:00.000Z' },
        ] }], coverage: [
          { reviewId: 'review-1', originalText: 'I had to ask three times what happened next.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['theme-1'] },
          { reviewId: 'review-2', originalText: 'The next update arrived a day later.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['theme-1'] },
        ],
      } }), { status: 200, headers: { 'content-type': 'application/json' } }))

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    expect(screen.getByLabelText('Choose CSV file')).toHaveAttribute('accept', '.csv,text/csv')
    expect(screen.queryByRole('textbox', { name: /feedback for demo analysis/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download CSV template' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download demo PDF' })).not.toBeInTheDocument()
    await submitDemoCsv()

    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Visible progress' }).length).toBeGreaterThan(0))
    expect(screen.getByRole('img', { name: 'Dated feedback volume' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voice Map' }))
    expect(screen.getByText(/I had to ask three times what happened next/, { selector: 'blockquote' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download demo PDF' })).toHaveAttribute('href', `/api/demo/analysis-runs/${'a'.repeat(43)}/pdf`)
    expect(screen.getAllByText(/expires after 24 hours/i).length).toBeGreaterThan(0)
  })

  it('does not present praise as a primary pain or desired outcome', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'p'.repeat(43), status: 'queued', expiresAt: '2026-08-11T10:00:00.000Z' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        status: 'completed', demo: true, pdfUrl: '/demo.pdf',
        themes: [{ id: 'praise-1', name: 'Kind support', summary: 'Customers praise the support team.', type: 'praise', confidence: 'high', evidence: [{ reviewId: 'review-1', quote: 'The support team was kind.', originalText: 'The support team was kind.' }] }],
        coverage: [{ reviewId: 'review-1', originalText: 'The support team was kind.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['praise-1'], signals: [] }],
      } }), { status: 200 }))

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active'))
    fireEvent.click(screen.getByRole('button', { name: 'Voice Map' }))
    expect(screen.getByText('01 · Primary pain')).toBeInTheDocument()
    expect(screen.getByText('01 · Primary pain').parentElement).toHaveTextContent('No primary pain signal identified')
    expect(screen.getByRole('heading', { name: 'Desired outcome' }).closest('article')).toHaveTextContent('No retained feedback was categorized here')
  })

  it('renders generic positive praise as emotion with positive sentiment', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'e'.repeat(43), status: 'queued', expiresAt: '2026-08-11T10:00:00.000Z' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        status: 'completed', demo: true, pdfUrl: '/demo.pdf',
        themes: [{ id: 'praise-1', name: 'Warm welcome', topic: 'staff welcome', primarySignalType: 'emotion', type: 'praise', sentiment: 'positive', confidence: 'high', evidence: [{ reviewId: 'review-1', quote: 'Everyone was genuinely kind.', originalText: 'Everyone was genuinely kind.' }] }],
        coverage: [{ reviewId: 'review-1', originalText: 'Everyone was genuinely kind.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['praise-1'], signals: [{ label: 'Warm welcome', topic: 'staff welcome', signalType: 'emotion', category: 'emotion', sentiment: 'positive', confidence: .9, quote: 'Everyone was genuinely kind.', interpretedBy: 'analysis_engine' }] }],
      } }), { status: 200 }))

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active'))
    fireEvent.click(screen.getByRole('button', { name: 'Voice Map' }))
    expect(screen.getByRole('button', { name: /Warm welcome, 1 supporting reviews, emotion/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Emotional driver' }).closest('article')).toHaveTextContent('Warm welcome')
  })

  it('shows real queued, interpretation, and completed progress before opening evidence', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'b'.repeat(43), status: 'queued', expiresAt: '2026-08-11T10:00:00.000Z' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'queued', stage: 'queued', demo: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'interpreting_clusters', stage: 'interpreting_clusters', demo: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'completed', stage: 'completed', demo: true, engine: 'llm-interpreted-theme-engine-v1', pdfUrl: '/demo.pdf', themes: [{ id: 'theme-1', name: 'Clear milestones', summary: 'Customers need predictable updates.', type: 'pain', confidence: 'Emerging', evidence: [{ reviewId: 'review-1', quote: 'tell me what happens next', quoteStart: 7, quoteEnd: 32, originalText: 'Please tell me what happens next before I need to chase the team.', entity: 'Demo submission' }] }], coverage: [{ reviewId: 'review-1', originalText: 'Please tell me what happens next before I need to chase the team.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['theme-1'], signals: [] }] } }), { status: 200 }))
    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    await submitDemoCsv()
    await waitFor(() => expect(screen.getByText('Upload & map')).toHaveAttribute('aria-current', 'step'))
    await waitFor(() => expect(screen.getByText('Analyze')).toHaveAttribute('aria-current', 'step'), { timeout: 2500 })
    expect(await screen.findByRole('heading', { name: 'Overview' }, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Voice Map mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active')
    expect(screen.queryByRole('region', { name: 'Feedback coverage' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Project navigation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voice Map' }))
    expect(screen.getByRole('group', { name: 'Interactive evidence bucket bubbles' })).toBeInTheDocument()
    expect(screen.getByText('View buckets as an accessible table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Clear milestones, 1 supporting reviews/ }))
    expect(screen.getAllByText('Please tell me what happens next before I need to chase the team.').length).toBeGreaterThan(0)
    expect(screen.getByText('tell me what happens next', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Feedback coverage' })).toHaveTextContent(/recurring/i)
  })

  it('opens the separate token-scoped Curation section without putting editing controls in Voice Map', async () => {
    const token = 'c'.repeat(43)
    const result = { status: 'completed', stage: 'completed', demo: true, engine: 'llm-interpreted-theme-engine-v1', expiresAt: '2026-08-11T10:00:00.000Z', pdfUrl: `/api/demo/analysis-runs/${token}/pdf`, themes: [{ id: 'theme-1', name: 'Clear milestones', summary: 'Customers need predictable updates.', type: 'pain', confidence: 'Emerging', origin: 'model_confirmed', evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'Please tell me what happens next.', quoteStart: 0, quoteEnd: 33, originalText: 'Please tell me what happens next.', entity: 'Demo submission', provider: 'demo', rating: null, sourceCreatedAt: null, confidence: .8, pinned: false, excluded: false }] }], coverage: [{ reviewId: 'review-1', originalText: 'Please tell me what happens next.', disposition: 'recurring', reason: 'Validated recurring signal.', themeIds: ['theme-1'], signals: [] }] }
    const projection = { session: { id: 'curation-1', analysisRunId: 'run-1', status: 'in_progress', revision: 0, createdAt: '2026-08-10T10:00:00.000Z', readyAt: null }, machineThemes: [], effectiveThemes: [{ id: 'theme-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1, name: 'Clear milestones', summary: 'Customers need predictable updates.', type: 'pain', sentiment: 'negative', confidence: 'Emerging', validationStatus: 'validated', status: 'pending', evidence: result.themes[0].evidence, groupingSuggestion: null, publishable: false, origin: 'model_confirmed', provenance: { createdBy: null, createdAt: null, sourceReviewIds: [] } }], actions: [], readiness: { validatedMachineThemes: 1, resolved: 0, pending: 1, approved: 0, rejected: 0, consumed: 0, publishable: 0, canMarkReady: false, isReady: false } }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token, status: 'queued', expiresAt: result.expiresAt } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: result }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: projection }), { status: 200 }))

    render(<PublicDemo onBack={vi.fn()} onLogin={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Curation$/ })).toBeDisabled()
    await submitDemoCsv()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('active'))
    expect(screen.getByRole('button', { name: /^Curation$/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Create custom bucket' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Curation$/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /Refine the analysis without losing the evidence/i })).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent(/temporary demo curation/i)
    expect(screen.queryByRole('tablist', { name: 'Voice Map mode' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/demo/analysis-runs/${token}/curation`, expect.anything())
  })
})
