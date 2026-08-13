import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { sampleCsv } from './lib/csv'

async function renderApp() {
  const result = render(<App />)
  const login = screen.queryByRole('button', { name: 'Log in' })
  if (login) fireEvent.click(login)
  await screen.findByRole('complementary', { name: 'Project navigation' })
  return result
}

async function chooseSampleCsv(fileName = 'reviews.csv') {
  const file = new File([sampleCsv], fileName, { type: 'text/csv' })
  if (!file.text) Object.defineProperty(file, 'text', { value: async () => sampleCsv })
  fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [file] } })
  await screen.findByRole('table', { name: 'CSV mapping preview' })
}

describe('public routes', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it.each(['#product', '#examples', '#resources', '#about'])('keeps %s on the single public homepage', (hash) => {
    window.history.replaceState(null, '', hash)
    render(<App />)
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    for (const id of ['product', 'examples', 'resources', 'about']) expect(document.getElementById(id)).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Trusted output')
    expect(screen.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument()
  })
})

describe('Voice Map workspace', () => {
  it('lands on Overview and keeps Voice Map as a separate top-level section', async () => {
    await renderApp()
    const dashboardHeaders = document.querySelectorAll('.topbar')
    expect(dashboardHeaders).toHaveLength(1)
    expect(within(dashboardHeaders[0] as HTMLElement).getByRole('link', { name: 'Voice Lab home' })).toBeInTheDocument()
    expect(screen.queryByText(/garaxe\.voice/i)).not.toBeInTheDocument()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    expect(within(navigation).getByRole('button', { name: 'Overview' })).toHaveClass('active')
    expect(within(navigation).getByRole('button', { name: 'Voice Map' })).not.toHaveClass('active')
    expect(await screen.findByText(/Emerging/, { selector: '.dataset-card div' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Voice Map mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Evidence context', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Feedback coverage' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Setup complexity is the clearest friction.' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter review period Jan 2026 – Jul 2026' })).toBeInTheDocument()
    fireEvent.click(within(navigation).getByRole('button', { name: 'Voice Map' }))
    expect(await screen.findByRole('region', { name: 'Feedback coverage' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: 'Investigate' }))
    const rankedThemes = await screen.findByRole('list', { name: 'Ranked themes' })
    fireEvent.click(within(rankedThemes).getByRole('button', { name: /Setup Complexity/i }))
    const dialog = await screen.findByRole('dialog', { name: /Setup complexity/i })
    expect(within(dialog).getByText('The setup took days', { selector: 'mark' })).toBeInTheDocument()
    expect(within(dialog).getByText(/support never replied/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close evidence' }))
    expect(screen.queryByRole('dialog', { name: /Setup complexity/i })).not.toBeInTheDocument()
  })

  it('opens Curation directly from the live-data Overview', async () => {
    await renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Curation' }))
    expect(await screen.findByRole('heading', { name: /Refine the analysis without losing the evidence/i })).toBeInTheDocument()
  })

  it('keeps canonical emerging bucket citations linked from Overview', async () => {
    const mockedFetch = vi.mocked(fetch)
    const fallback = mockedFetch.getMockImplementation()!
    mockedFetch.mockImplementation(async (input, init) => {
      const path = String(input)
      if (path.endsWith('/curation')) return { ok: true, json: async () => ({ data: {
        session: null, machineThemes: [], actions: [], readiness: { isReady: false },
        effectiveThemes: [{
          id: 'canonical-emerging-1', machineThemeId: 'theme-1', originThemeIds: ['theme-1'], rank: 1,
          name: 'Accessible parcel lockers', topic: 'parcel locker access', summary: 'One exact comment describes the access barrier.',
          type: 'pain', signalTypes: ['pain'], categories: ['pain'], sentiment: 'negative', confidence: 'Emerging',
          validationStatus: 'validated', status: 'pending', groupingSuggestion: null, publishable: false, origin: 'model_confirmed',
          provenance: { createdBy: null, createdAt: null, sourceReviewIds: ['review-1'] },
          evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'screen is too high', quoteStart: 18, quoteEnd: 36, originalText: 'The parcel locker screen is too high.', provider: 'csv_import', confidence: .8, pinned: false, excluded: false }],
        }],
      } }) } as Response
      if (path.endsWith('/coverage')) return { ok: true, json: async () => ({ data: [{
        reviewId: 'review-1', originalText: 'The parcel locker screen is too high.', disposition: 'emerging', reason: 'One grounded signal.', themeIds: [],
        signals: [{ label: 'Parcel locker access', topic: 'parcel locker access', signalType: 'pain', signalTypes: ['pain'], category: 'pain', categories: ['pain'], sentiment: 'negative', confidence: .8, quote: 'screen is too high', interpretedBy: 'analysis_engine' }],
      }] }) } as Response
      if (path.endsWith('/overview')) return { ok: true, json: async () => ({ data: {
        status: 'ready', schemaVersion: 'overview-intelligence-v1', brief: {
          understood: { title: 'Access blocks completion', narrative: 'The saved evidence identifies a physical access barrier.', themeIds: ['canonical-emerging-1'] },
          majorOpportunity: null, majorRisk: null, salesImplications: [], marketingImplications: [], nextActions: [],
        },
      } }) } as Response
      return fallback(input, init)
    })

    await renderApp()
    expect(await screen.findByRole('button', { name: 'Open evidence for Accessible parcel lockers' })).toBeInTheDocument()
  })

  it('does not expose the unfinished Evidence route as working navigation', async () => {
    await renderApp()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    for (const name of ['Evidence']) {
      expect(within(navigation).getByRole('button', { name })).toBeDisabled()
    }
  })

  it('builds Copy Lab drafts from the project evidence basis', async () => {
    await renderApp()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Copy Lab' }))
    expect(await screen.findByRole('heading', { name: 'Build from customer language.' })).toBeInTheDocument()
    expect(screen.getByText('Copy Lab', { selector: '.topbar-title' })).toBeInTheDocument()
    expect(screen.getByText(/2 reviews · emerging confidence/i)).toBeInTheDocument()
    expect(screen.getAllByText(/The setup took days/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Open source review' }))
    const reviewDialog = await screen.findByRole('dialog', { name: 'Acme' })
    expect(
      within(reviewDialog).getByText(/The setup took days/, { selector: 'blockquote' }),
    ).toBeInTheDocument()
  })

  it('keeps signal evidence keyboard-contained and traverses to the exact source review', async () => {
    await renderApp()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Pain Phrases' }))
    const themes = await screen.findByRole('list', { name: 'Pain phrases themes' })
    const themeButton = within(themes).getByRole('button', { name: /Setup complexity/i })
    themeButton.focus()
    fireEvent.click(themeButton)
    let dialog = await screen.findByRole('dialog', { name: 'Setup complexity' })
    const close = within(dialog).getByRole('button', { name: 'Close evidence' })
    const source = within(dialog).getByRole('button', { name: 'Open source review' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(source).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Setup complexity' })).not.toBeInTheDocument()
    expect(themeButton).toHaveFocus()

    fireEvent.click(themeButton)
    dialog = await screen.findByRole('dialog', { name: 'Setup complexity' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open source review' }))
    const reviewDialog = await screen.findByRole('dialog', { name: 'Acme' })
    expect(
      within(reviewDialog).getByText(/The setup took days/, { selector: 'blockquote' }),
    ).toBeInTheDocument()
    expect(within(reviewDialog).getByText('source-record-1 · row 1')).toBeInTheDocument()
  })

  it.each([
    ['Pain Phrases', 'Where the experience breaks down.'],
    ['Outcomes', 'What customers are trying to reach.'],
    ['Objections', 'What makes customers hesitate.'],
    ['Emotional Triggers', 'The feeling underneath the feedback.'],
  ])('opens the project-backed %s workspace', async (navigationLabel, heading) => {
    await renderApp()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: navigationLabel }))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('routes export to immutable project reports instead of fixture JSON', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Export Voice Map' }))
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    expect(within(navigation).getByRole('button', { name: 'Reports' })).toHaveClass('active')
    expect(await screen.findByRole('heading', { name: 'Acme Voice Map' })).toBeInTheDocument()
  })

  it('maps and imports a canonical CSV dataset', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    await chooseSampleCsv()
    const importButton = screen.getByRole('button', { name: 'Import CSV' })
    await waitFor(() => expect(importButton).toBeEnabled())
    fireEvent.click(importButton)
    expect(await screen.findByRole('heading', { name: 'The source material, in full.' })).toBeInTheDocument()
    expect(screen.getByText('5', { selector: 'dd' })).toBeInTheDocument()
  })

  it('creates a project and opens its Sources workspace', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Create new project' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Northstar Clinics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Bring in the words your customers already use.')).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Northstar Clinics' }).length).toBeGreaterThan(0)
  })

  it('clears staged import data when the selected project changes', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    await chooseSampleCsv('project-a.csv')
    expect(screen.getByRole('table', { name: 'CSV mapping preview' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create new project' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Clean Project State' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(screen.queryByRole('table', { name: 'CSV mapping preview' })).not.toBeInTheDocument())
    expect(screen.queryByText('project-a.csv')).not.toBeInTheDocument()
  })

  it('switches between authorized projects and returns to the default Overview', async () => {
    const request = vi.mocked(fetch)
    request.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/projects') return { ok: true, json: async () => ({ data: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Software', primaryDecision: 'positioning' },
        { id: '66666666-6666-4666-8666-666666666666', name: 'Food Industry 100', primaryDecision: 'retention' },
      ] }) } as Response
      return { ok: true, json: async () => ({ data: path === '/api/auth/status' ? { needsBootstrap: false } : path === '/api/auth/me' ? { sessionId: 'session-1', user: { id: 'user-1', email: 'owner@example.com', displayName: 'Alex Rivera' }, memberships: [{ organizationId: 'org-1', organizationName: 'Acme Software', role: 'owner' }] } : path.includes('/review-summary') ? { total: 0, writtenCount: 0, ratingOnlyCount: 0, providerCount: 0, entityCount: 0, earliestDate: null, latestDate: null, averageRating: null, breakdowns: { providers: [], entities: [], ratings: [], languages: [] } } : [] }) } as Response
    })
    await renderApp()
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch project from top bar' }), { target: { value: '66666666-6666-4666-8666-666666666666' } })
    expect(screen.getAllByRole('combobox').every((select) => (select as HTMLSelectElement).value === '66666666-6666-4666-8666-666666666666')).toBe(true)
    expect(within(screen.getByRole('complementary', { name: 'Project navigation' })).getByRole('button', { name: 'Overview' })).toHaveClass('active')
  })

  it('keeps an active date-analysis status scoped to the project that started it', async () => {
    const request = vi.mocked(fetch)
    request.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/projects') return { ok: true, json: async () => ({ data: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'First project', primaryDecision: 'positioning' },
        { id: '66666666-6666-4666-8666-666666666666', name: 'Empty project', primaryDecision: 'retention' },
      ] }) } as Response
      if (path === '/api/analysis-runs' && init?.method === 'POST') return { ok: true, json: async () => ({ data: { id: 'run-pending', status: 'queued' } }) } as Response
      if (path === '/api/analysis-runs/run-pending') return new Promise<Response>(() => undefined)
      return { ok: true, json: async () => ({ data: path === '/api/auth/status' ? { needsBootstrap: false } : path === '/api/auth/me' ? { sessionId: 'session-1', user: { id: 'user-1', email: 'owner@example.com', displayName: 'Alex Rivera' }, memberships: [{ organizationId: 'org-1', organizationName: 'First project', role: 'owner' }] } : path.includes('/review-summary') ? { total: 0, writtenCount: 0, ratingOnlyCount: 0, providerCount: 0, entityCount: 0, earliestDate: null, latestDate: null, averageRating: null, breakdowns: { providers: [], entities: [], ratings: [], languages: [] } } : [] }) } as Response
    })
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Filter review period No review dates' }))
    const dateFilter = screen.getByRole('form', { name: 'Date range filter' })
    fireEvent.change(within(dateFilter).getByLabelText('From'), { target: { value: '2026-01-01' } })
    fireEvent.change(within(dateFilter).getByLabelText('To'), { target: { value: '2026-01-02' } })
    fireEvent.click(within(dateFilter).getByRole('button', { name: 'Analyze range' }))
    expect(await screen.findByText('Analyzing range…')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Switch project from top bar' }), { target: { value: '66666666-6666-4666-8666-666666666666' } })
    expect(screen.queryByText('Analyzing range…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter review period No review dates' })).toBeInTheDocument()
  })

  it('shows the authenticated identity and logs out through the local fallback when Supabase is absent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    await renderApp()
    expect(screen.getByText('owner@example.com · owner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Log in to Voice Lab' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  it('opens the upper account menu with email and applies an immutable date-window run', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const account = screen.getByRole('region', { name: 'Account details' })
    expect(within(account).getByText('owner@example.com')).toBeInTheDocument()
    expect(within(account).getByRole('button', { name: 'Log out' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter review period Jan 2026 – Jul 2026' }))
    const dateFilter = screen.getByRole('form', { name: 'Date range filter' })
    fireEvent.change(within(dateFilter).getByLabelText('From'), { target: { value: '2026-03-01' } })
    fireEvent.change(within(dateFilter).getByLabelText('To'), { target: { value: '2026-05-31' } })
    fireEvent.click(within(dateFilter).getByRole('button', { name: 'Analyze range' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/analysis-runs', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"dateFrom":"2026-03-01"'),
    })))
    expect(fetch).toHaveBeenCalledWith('/api/analysis-runs', expect.objectContaining({ body: expect.stringContaining('"dateTo":"2026-05-31"') }))
  })

  it('explains an inverted evidence window instead of silently blocking submission', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Filter review period Jan 2026 – Jul 2026' }))
    const dateFilter = screen.getByRole('form', { name: 'Date range filter' })
    const from = within(dateFilter).getByLabelText('From')
    const to = within(dateFilter).getByLabelText('To')
    fireEvent.change(from, { target: { value: '2026-06-01' } })
    fireEvent.change(to, { target: { value: '2026-05-01' } })

    expect(dateFilter).toHaveAttribute('novalidate')
    fireEvent.click(within(dateFilter).getByRole('button', { name: 'Analyze range' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The start date must be before the end date.')
  })

  it('accepts an uploaded CSV file', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    await chooseSampleCsv()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeEnabled()
    expect(screen.getByText('reviews.csv')).toBeInTheDocument()
  })

  it('keeps arbitrary pasted feedback out of the CSV-only import boundary', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    expect(screen.queryByLabelText(/paste feedback/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /map pasted feedback/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download CSV template' })).toBeInTheDocument()
    expect(screen.getByLabelText('Choose CSV file')).toHaveAttribute('accept', '.csv,text/csv')
  })

  it('creates an immutable analysis run and renders its quality report', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Analysis' }))
    expect(await screen.findByRole('heading', { name: 'Decide what the evidence should answer.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))
    expect(await screen.findByRole('heading', { name: '4 reviews form the evidence base.' })).toBeInTheDocument()
    expect(screen.getByText('Saved evidence set')).toBeInTheDocument()
    expect(screen.queryByText('deterministic-preprocessing-v1')).not.toBeInTheDocument()
  })

  it('renders a persisted evidence-backed Voice Map and investigate mode', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Voice Map' }))
    expect(await screen.findByRole('heading', { name: 'Setup complexity', level: 1 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Investigate' }))
    expect(screen.getByRole('heading', { name: 'Every conclusion has a trail.' })).toBeInTheDocument()
  })

  it('renders an immutable report snapshot from the Reports navigation', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Reports' }))
    expect(await screen.findByRole('heading', { name: 'Setup complexity', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Immutable snapshot')).toBeInTheDocument()
    expect(screen.getByText(/The setup took days/)).toBeInTheDocument()
  })
})
