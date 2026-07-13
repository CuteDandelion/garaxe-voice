import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { sampleCsv } from './lib/csv'

async function renderApp() {
  const result = render(<App />)
  await screen.findByRole('complementary', { name: 'Project navigation' })
  return result
}

describe('Voice Map workspace', () => {
  it('lands on Voice Map and opens full exact project evidence', async () => {
    await renderApp()
    const navigation = screen.getByRole('complementary', { name: 'Project navigation' })
    expect(within(navigation).queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'Voice Map' })).toHaveClass('active')
    expect(await screen.findByText(/Emerging/, { selector: '.dataset-card div' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter review period Jan 2026 – Jul 2026' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: 'Investigate' }))
    const rankedThemes = await screen.findByRole('list', { name: 'Ranked themes' })
    fireEvent.click(within(rankedThemes).getByRole('button', { name: /Setup Complexity/i }))
    const dialog = await screen.findByRole('dialog', { name: /Setup complexity/i })
    expect(within(dialog).getByText('The setup took days', { selector: 'mark' })).toBeInTheDocument()
    expect(within(dialog).getByText(/support never replied/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close evidence' }))
    expect(screen.queryByRole('dialog', { name: /Setup complexity/i })).not.toBeInTheDocument()
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

  it('maps and imports the sample CSV dataset', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    fireEvent.click(screen.getByRole('button', { name: /use sample dataset/i }))
    const importButton = screen.getByRole('button', { name: 'Import 5 records' })
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
    fireEvent.click(screen.getByRole('button', { name: /use sample dataset/i }))
    expect(screen.getByRole('table', { name: 'Feedback column mapping' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create new project' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Clean Project State' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(screen.queryByRole('table', { name: 'Feedback column mapping' })).not.toBeInTheDocument())
    expect(screen.queryByText('garaxe-sample-reviews.csv')).not.toBeInTheDocument()
  })

  it('switches between authorized projects and returns to the default Voice Map', async () => {
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
    expect(within(screen.getByRole('complementary', { name: 'Project navigation' })).getByRole('button', { name: 'Voice Map' })).toHaveClass('active')
  })

  it('shows the authenticated identity and logs out through the server', async () => {
    await renderApp()
    expect(screen.getByText('owner@example.com · owner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Your workspace is protected.' })).toBeInTheDocument()
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

  it('accepts an uploaded CSV file', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    const input = screen.getByLabelText('Upload customer feedback file')
    const file = new File([sampleCsv], 'reviews.csv', { type: 'text/csv' })
    if (!file.text) Object.defineProperty(file, 'text', { value: async () => sampleCsv })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('button', { name: 'Import 5 records' })).toBeEnabled()
    expect(screen.getByText('reviews.csv')).toBeInTheDocument()
  })

  it('maps pasted feedback without requiring a file', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Sources' }))
    fireEvent.change(screen.getByLabelText('Or paste feedback'), { target: { value: 'Friendly staff\nSetup took days' } })
    fireEvent.click(screen.getByRole('button', { name: 'Map pasted feedback' }))
    expect(screen.getByRole('table', { name: 'Feedback column mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 records' })).toBeEnabled()
  })

  it('creates an immutable analysis run and renders its quality report', async () => {
    await renderApp()
    const projectNavigation = screen.getByRole('complementary', { name: 'Project navigation' })
    fireEvent.click(within(projectNavigation).getByRole('button', { name: 'Analysis' }))
    expect(await screen.findByRole('heading', { name: 'Decide what the evidence should answer.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }))
    expect(await screen.findByRole('heading', { name: '4 reviews form the evidence base.' })).toBeInTheDocument()
    expect(screen.getByText('deterministic-preprocessing-v1')).toBeInTheDocument()
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
