import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildSignalStory, PhraseBubbleMap, VoiceMapWorkspace, type SynthesizedVoiceMap, type VoiceMapRunSummary, type VoiceMapTheme } from './VoiceMapWorkspace'

const run: VoiceMapRunSummary = {
  id: 'run-voice-map-01', createdAt: '2026-07-12T10:00:00Z', reviewCount: 184, themeCount: 1, confidence: 'high', pipelineVersion: 'voice-map-v1',
}

const theme: VoiceMapTheme = {
  id: 'theme-setup', rank: 1, name: 'Configuration fatigue', type: 'pain', signalTypes: ['pain'], confidence: 'high',
  summary: 'Customers describe the cognitive cost of configuration.', representativeQuote: 'Every other solution required too much setup.',
  metrics: { reviewCount: 84, signalCount: 97, prevalence: .46, averageRating: 2.1, trend: .18, contradictionRate: .04 },
  topPhrases: [{ text: 'too much setup', count: 21 }], entityBreakdown: [{ label: 'Berlin', count: 52 }], languageBreakdown: [{ label: 'en', count: 84 }],
  evidence: [{ id: 'evidence-1', reviewId: 'review-1', quote: 'I just wanted it to work.', quoteStart: 19, quoteEnd: 44, originalText: 'After a long setup I just wanted it to work. The final result was solid.', rating: 2, ratingScale: 5, provider: 'csv_import', entity: 'Berlin', language: 'en', sourceCreatedAt: '2026-06-10', sourceUrl: null, strength: .97 }],
}

const insight = (id: string, type: 'primary_pain' | 'desired_outcome' | 'main_objection' | 'emotional_driver', title: string) => ({
  id, type, title, narrative: `${title} is consistently supported by customer evidence.`, confidence: 'high' as const, reviewCount: 84, supportingThemeIds: [theme.id],
})

const voiceMap: SynthesizedVoiceMap = {
  conclusion: { title: 'Customers are buying relief from complexity.', narrative: 'The strongest customer language centers on a product that simply works.' },
  signals: {
    primaryPain: insight('pain', 'primary_pain', 'Configuration fatigue'),
    desiredOutcome: insight('outcome', 'desired_outcome', 'Confidence without technical effort'),
    mainObjection: insight('objection', 'main_objection', 'Doubt it will fit'),
    emotionalDriver: insight('emotion', 'emotional_driver', 'Relief and peace of mind'),
  },
  phrases: [
    { text: 'just wanted it to work', count: 41, themeId: theme.id, themeName: theme.name, category: theme.type },
    { text: 'too much setup', count: 12, themeId: theme.id, themeName: theme.name, category: theme.type },
    { text: 'clear onboarding', count: 3, themeId: theme.id, themeName: theme.name, category: 'desired_outcome' },
    { text: 'confusing account choice', count: 1, themeId: 'emerging-review-2', themeName: 'Confusing account choice', category: 'pain', state: 'emerging' },
  ],
  recommendedMoves: [{ id: 'move-1', owner: 'Messaging', action: 'Lead with relief, not feature depth.', supportingThemeIds: [theme.id] }],
}

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof VoiceMapWorkspace>> = {}) {
  const props: React.ComponentProps<typeof VoiceMapWorkspace> = {
    mode: 'read', status: 'ready', run, voiceMap, themes: [theme], selectedThemeId: null,
    onModeChange: vi.fn(), onThemeSelect: vi.fn(), onThemeClose: vi.fn(), onOpenReview: vi.fn(), onOpenCuration: vi.fn(), ...overrides,
  }
  render(<VoiceMapWorkspace {...props} />)
  return props
}

describe('VoiceMapWorkspace', () => {
  it('builds a stable exact-once Signal Story from saved theme evidence', () => {
    const themes: VoiceMapTheme[] = [
      {
        ...theme, id: 'pain', type: 'pain', metrics: { ...theme.metrics, reviewCount: 2 },
        evidence: [
          { ...theme.evidence[0], id: 'a', reviewId: 'a', provider: 'google_business', sourceCreatedAt: '2026-01-04' },
          { ...theme.evidence[0], id: 'b', reviewId: 'b', rating: 4, provider: 'support_ticket', sourceCreatedAt: '2026-02-05' },
        ],
      },
      {
        ...theme, id: 'outcome', rank: 2, type: 'desired_outcome', metrics: { ...theme.metrics, reviewCount: 1 },
        evidence: [
          { ...theme.evidence[0], id: 'a-copy', reviewId: 'a', provider: 'google_business', sourceCreatedAt: '2026-01-04' },
          { ...theme.evidence[0], id: 'c', reviewId: 'c', provider: 'csv_import', sourceCreatedAt: 'invalid' },
        ],
      },
    ]

    expect(buildSignalStory(themes)).toEqual({
      topicMix: [
        { key: 'pain', label: 'Configuration fatigue', count: 2, share: 67, color: '#d7683b' },
        { key: 'outcome', label: 'Configuration fatigue', count: 1, share: 33, color: '#56745f' },
      ],
      categoryMix: [
        { key: 'pain', label: 'Pain', count: 2, share: 67 },
        { key: 'desired_outcome', label: 'Desired outcome', count: 1, share: 33 },
      ],
      sourceMix: [
        { key: 'google_reviews', label: 'Google reviews', count: 1, share: 33 },
        { key: 'support_tickets', label: 'Support tickets', count: 1, share: 33 },
        { key: 'uploaded_csv', label: 'Uploaded CSV', count: 1, share: 33 },
      ],
      timeline: [
        { date: '2025-12-29', count: 1 },
        { date: '2026-02-02', count: 1 },
      ],
      topicTimeline: [
        { date: '2025-12-29', counts: { pain: 1 } },
        { date: '2026-02-02', counts: { pain: 1 } },
      ],
      experienceTimeline: [
        { date: '2025-12-29', negative: 1, neutral: 0, positive: 0, unrated: 0, averageRatingPercent: 40, averageRating: 2, ratingScale: 5, ratedCount: 1 },
        { date: '2026-02-02', negative: 0, neutral: 0, positive: 1, unrated: 0, averageRatingPercent: 80, averageRating: 4, ratingScale: 5, ratedCount: 1 },
      ],
    })
  })

  it('groups uploaded CSV source aliases into one visible source', () => {
    const evidence = [
      { ...theme.evidence[0], id: 'csv', reviewId: 'csv', provider: 'csv_import' },
      { ...theme.evidence[0], id: 'demo', reviewId: 'demo', provider: 'demo_submission' },
    ]

    expect(buildSignalStory([{ ...theme, evidence }]).sourceMix).toEqual([
      { key: 'uploaded_csv', label: 'Uploaded CSV', count: 2, share: 100 },
    ])
  })

  it('opens a live-data decision brief without coverage plumbing or a duplicate map', () => {
    const onOpenVoiceMap = vi.fn()
    const timelineTheme = { ...theme, evidence: [theme.evidence[0], { ...theme.evidence[0], id: 'evidence-2', reviewId: 'review-2', sourceCreatedAt: '2026-06-11' }] }
    const props = renderWorkspace({ mode: 'overview', section: 'overview', themes: [timelineTheme], onOpenVoiceMap, overviewBrief: {
      status: 'ready', schemaVersion: 'overview-intelligence-v1',
      brief: {
        understood: { title: 'Configuration effort is the decision barrier.', narrative: 'Customers want a guided setup path before they trust the outcome.', themeIds: [theme.id] },
        majorOpportunity: { title: 'Lead with guided setup', narrative: 'Show the shortest path to first value.', themeIds: [theme.id] },
        majorRisk: { title: 'Proof remains thin', narrative: 'The current evidence comes from one recurring topic.', themeIds: [theme.id] },
        salesImplications: [{ title: 'Sell the handoff', narrative: 'Make onboarding evidence visible in sales conversations.', themeIds: [theme.id] }],
        marketingImplications: [{ title: 'Show the proof', narrative: 'Lead with the evidence trail in campaign material.', themeIds: [theme.id] }],
        nextActions: [
          { title: 'Publish a guided setup proof', rationale: 'It directly addresses the strongest evidence bucket.', themeIds: [theme.id] },
          { title: 'Secondary product task', rationale: 'Keep this below the primary card.', themeIds: [theme.id] },
        ],
      },
    } } as never)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Signal Story · saved evidence')).toBeInTheDocument()
    expect(screen.queryByText('Secondary product task')).not.toBeInTheDocument()
    const intelligenceBanner = screen.getByRole('region', { name: 'Signal intelligence' })
    const timeline = screen.getByRole('figure', { name: 'Topic composition over time' })
    expect(intelligenceBanner.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(timeline).toHaveClass('is-primary')
    expect(screen.getByRole('figure', { name: 'Feedback over time' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Rated experience over time' })).toBeInTheDocument()
    expect(screen.getByText('1 = very negative · 5 = very positive')).toBeInTheDocument()
    expect(screen.getByLabelText(/Jun 10, 2026: 1 submitted feedback/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Jun 10, 2026: 2\/5 average mapped rating, 1 rated feedback/)).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded CSV: 2 feedback, 100%')).toHaveAttribute('data-tooltip', 'Uploaded CSV: 2 feedback, 100%')
    expect(screen.getByLabelText('Pain: 2 feedback, 100%')).toHaveAttribute('data-tooltip', 'Pain: 2 feedback, 100%')
    expect(screen.getByRole('figure', { name: 'Source mix' })).toBeInTheDocument()
    expect(screen.getByText('Known source aliases are grouped; stored provider values stay intact.')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Category composition' })).toBeInTheDocument()
    const primaryRow = document.querySelector('.voice-map-workspace__story-primary')
    expect(primaryRow).not.toBeNull()
    expect(primaryRow?.querySelectorAll('figure')).toHaveLength(3)
    expect(primaryRow?.querySelector('[aria-label="Feedback over time"]')).toBeInTheDocument()
    expect(primaryRow?.querySelector('[aria-label="Topic composition over time"]')).toBeInTheDocument()
    expect(primaryRow?.querySelector('[aria-label="Source mix"]')).toBeInTheDocument()
    expect(document.querySelector('.voice-map-workspace__story-support')?.querySelectorAll('figure')).toHaveLength(2)
    expect(document.querySelectorAll('.voice-map-workspace__topic-heatmap button').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Sort topics')).toHaveValue('highest')
    const topicCell = screen.getAllByLabelText(/Configuration fatigue: 1 mention, 100% of this period/)[0]
    expect(topicCell).toHaveAttribute('data-tooltip', topicCell.getAttribute('aria-label'))
    expect(screen.queryByRole('figure', { name: 'Signal recurrence' })).not.toBeInTheDocument()
    expect(screen.getByText('Uploaded CSV').closest('.voice-map-workspace__story-source')?.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /feedback coverage|analysis coverage|evidence buckets/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Top evidence buckets' })).not.toBeInTheDocument()
    expect(screen.queryByText('just wanted it to work')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Configuration effort is the decision barrier.' })).toBeInTheDocument()
    for (const label of ['What Voice Lab understood', 'Major opportunity', 'Major risk', 'Sales', 'Marketing', 'Product & team']) {
      expect(screen.getByText(label).closest('article, section')?.querySelector('svg')).toBeInTheDocument()
    }
    expect(screen.getByRole('region', { name: 'Recommended actions' })).toBeInTheDocument()
    expect(document.querySelector('meter')).not.toBeInTheDocument()
    const citations = screen.getAllByRole('button', { name: /Open evidence for Configuration fatigue/i })
    expect(citations.length).toBeGreaterThan(1)
    citations.forEach((citation) => fireEvent.click(citation))
    expect(props.onThemeSelect).toHaveBeenCalledTimes(citations.length)
    expect(props.onThemeSelect).toHaveBeenCalledWith(theme.id)
    expect(screen.queryByRole('group', { name: 'Interactive evidence bucket bubbles' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Voice Map' }))
    expect(onOpenVoiceMap).toHaveBeenCalledWith('read')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect evidence' }))
    expect(onOpenVoiceMap).toHaveBeenCalledWith('investigate')
    fireEvent.click(screen.getByRole('button', { name: 'Open Curation' }))
    expect(props.onOpenCuration).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tablist', { name: 'Voice Map mode' })).not.toBeInTheDocument()
  })

  it('does not label one dated rating bucket as a trend', () => {
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [theme] })
    expect(screen.getByRole('figure', { name: 'Rating trend unavailable' })).toBeInTheDocument()
    expect(screen.queryByText('Ratings over time')).not.toBeInTheDocument()
  })

  it('uses adaptive calendar buckets for rating trends', () => {
    const dated = ['2026-01-02', '2026-01-15', '2026-02-01', '2026-02-18', '2026-03-02'].map((sourceCreatedAt, index) => ({
      ...theme.evidence[0], id: `adaptive-${index}`, reviewId: `adaptive-${index}`, sourceCreatedAt,
    }))
    const story = buildSignalStory([{ ...theme, evidence: dated }])
    expect(story.experienceTimeline?.map((item) => item.date)).toEqual(['2025-12-29', '2026-01-12', '2026-01-26', '2026-02-16', '2026-03-02'])

    const daily = ['2026-04-01', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-09'].map((sourceCreatedAt, index) => ({
      ...theme.evidence[0], id: `daily-${index}`, reviewId: `daily-${index}`, sourceCreatedAt,
    }))
    expect(buildSignalStory([{ ...theme, evidence: daily }]).experienceTimeline?.map((item) => item.date)).toEqual(daily.map((item) => item.sourceCreatedAt))

    const monthly = ['2025-01-03', '2025-03-03', '2025-06-03', '2025-09-03', '2026-01-03'].map((sourceCreatedAt, index) => ({
      ...theme.evidence[0], id: `monthly-${index}`, reviewId: `monthly-${index}`, sourceCreatedAt,
    }))
    expect(buildSignalStory([{ ...theme, evidence: monthly }]).experienceTimeline?.map((item) => item.date)).toEqual(['2025-01-01', '2025-03-01', '2025-06-01', '2025-09-01', '2026-01-01'])
  })

  it('shows timeline values on keyboard focus', () => {
    const timelineTheme = { ...theme, evidence: [theme.evidence[0], { ...theme.evidence[0], id: 'evidence-2', reviewId: 'review-2', rating: 4, sourceCreatedAt: '2026-06-11' }] }
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [timelineTheme] })
    fireEvent.focus(screen.getByLabelText(/Jun 10, 2026: 1 submitted feedback/))
    expect(screen.getAllByLabelText('Chart value')[0]).toHaveTextContent('Jun 10, 2026: 1 submitted feedback, 1 cumulative')
    expect(screen.getAllByLabelText('Chart value')[0]).toHaveStyle({ position: 'absolute' })
    expect(screen.getAllByLabelText('Chart value')[0].getAttribute('style')).toContain('left:')
    fireEvent.focus(screen.getByLabelText(/Jun 10, 2026: 2\/5 average mapped rating/))
    expect(screen.getAllByLabelText('Chart value')[1]).toHaveTextContent('Jun 10, 2026: 2/5 average mapped rating, 1 rated feedback')
  })

  it('renders ratings on the declared source scale without silent normalization', () => {
    const tenPointTheme = { ...theme, evidence: [
      { ...theme.evidence[0], id: 'ten-a', reviewId: 'ten-a', rating: 3, ratingScale: 10, sourceCreatedAt: '2026-05-01' },
      { ...theme.evidence[0], id: 'ten-b', reviewId: 'ten-b', rating: 8, ratingScale: 10, sourceCreatedAt: '2026-05-02' },
    ] }
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [tenPointTheme] })
    expect(screen.getByRole('img', { name: 'Average rating on 1–10 source scale over time' })).toBeInTheDocument()
    expect(screen.getByText('1 = lowest rating · 10 = highest rating')).toBeInTheDocument()
    expect(screen.getByLabelText(/May 1, 2026: 3\/10 average mapped rating/)).toBeInTheDocument()
  })

  it('does not combine incompatible rating scales into a trend', () => {
    const mixedScaleTheme = { ...theme, evidence: [
      { ...theme.evidence[0], id: 'mixed-a', reviewId: 'mixed-a', rating: 3, ratingScale: 5, sourceCreatedAt: '2026-05-01' },
      { ...theme.evidence[0], id: 'mixed-b', reviewId: 'mixed-b', rating: 8, ratingScale: 10, sourceCreatedAt: '2026-05-02' },
    ] }
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [mixedScaleTheme] })
    expect(screen.getByRole('figure', { name: 'Rating trend unavailable' })).toHaveTextContent('consistent declared positive scale')
  })

  it('falls back to compact evidence context without map-level topics when intelligence is unavailable', () => {
    renderWorkspace({ mode: 'overview', section: 'overview', overviewBrief: {
      status: 'evidence_only', schemaVersion: 'overview-intelligence-v1', brief: null,
      message: 'The intelligence brief is unavailable. Evidence context remains available.',
    } } as never)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Evidence context remains available')
    expect(screen.queryByRole('heading', { name: 'Top evidence buckets' })).not.toBeInTheDocument()
    expect(screen.queryByText('just wanted it to work')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: voiceMap.conclusion.title })).not.toBeInTheDocument()
  })

  it('shows time context only for two valid dated periods and ignores missing or invalid dates', () => {
    const datedTheme = {
      ...theme,
      metrics: { ...theme.metrics, reviewCount: 4, signalCount: 4 },
      evidence: [
        { ...theme.evidence[0], id: 'jan', reviewId: 'jan', sourceCreatedAt: '2026-01-31T23:59:59Z' },
        { ...theme.evidence[0], id: 'feb', reviewId: 'feb', sourceCreatedAt: '2026-02-01T00:00:00Z' },
        { ...theme.evidence[0], id: 'missing', reviewId: 'missing', sourceCreatedAt: null },
        { ...theme.evidence[0], id: 'invalid', reviewId: 'invalid', sourceCreatedAt: 'not-a-date' },
      ],
    }
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [datedTheme] })
    expect(screen.getByRole('figure', { name: 'Topic composition over time' })).toHaveClass('is-primary')
    expect(screen.getByRole('img', { name: 'Dated feedback volume' })).toBeInTheDocument()
    expect(screen.queryByText(/increased|decreased|improved|worsened/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No trend is shown/)).not.toBeInTheDocument()

    cleanup()
    renderWorkspace({ mode: 'overview', section: 'overview', themes: [{ ...datedTheme, evidence: datedTheme.evidence.slice(0, 1).concat(datedTheme.evidence.slice(2)) }] })
    expect(screen.getByText(/No topic timeline is shown because the saved evidence does not span enough valid dates/)).toBeInTheDocument()
  })

  it('keeps Overview out of the Voice Map section tabs', () => {
    renderWorkspace({ section: 'voice-map' })
    expect(screen.getByRole('tab', { name: 'Read' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Investigate' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('leads Read mode with the synthesized conclusion and evidence-linked themes', () => {
    const props = renderWorkspace()
    expect(screen.getByRole('heading', { name: voiceMap.conclusion.title })).toBeInTheDocument()
    expect(screen.getByText('Lead with relief, not feature depth.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Configuration fatigue/i })[0])
    expect(props.onThemeSelect).toHaveBeenCalledWith(theme.id)
  })

  it('renders ranked Investigate themes and requests a mode change', () => {
    const props = renderWorkspace({ mode: 'investigate' })
    expect(screen.getByRole('heading', { name: 'Every conclusion has a trail.' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Configuration fatigue/i }))
    expect(props.onThemeSelect).toHaveBeenCalledWith(theme.id)
    fireEvent.click(screen.getByRole('tab', { name: /Read/i }))
    expect(props.onModeChange).toHaveBeenCalledWith('read')
  })

  it('exposes exact evidence in a keyboard-dismissible dialog', () => {
    const props = renderWorkspace({ selectedThemeId: theme.id })
    expect(screen.getByRole('dialog', { name: theme.name })).toBeInTheDocument()
    const highlighted = screen.getByText('I just wanted it to work.', { selector: 'mark' })
    expect(highlighted.closest('p')).toHaveTextContent(theme.evidence[0].originalText)
    fireEvent.click(screen.getByRole('button', { name: /Open source review/i }))
    expect(props.onOpenReview).toHaveBeenCalledWith('review-1')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onThemeClose).toHaveBeenCalled()
  })

  it('shows an unavailable marker when a legacy theme omits contradiction metrics', () => {
    const legacyTheme = {
      ...theme,
      metrics: { ...theme.metrics, contradictionRate: undefined },
    } as unknown as VoiceMapTheme
    renderWorkspace({ themes: [legacyTheme], selectedThemeId: legacyTheme.id })
    const dialog = screen.getByRole('dialog', { name: legacyTheme.name })
    expect(dialog).toHaveTextContent('Contradiction—')
    expect(dialog).not.toHaveTextContent('NaN%')
  })

  it('opens theme evidence from a keyboard-accessible bucket bubble and table fallback', () => {
    const props = renderWorkspace()
    const bubble = screen.getByRole('button', { name: /Configuration fatigue, 41 supporting reviews/i })
    expect(bubble).toHaveAccessibleName(/Uploaded CSV.*Jun 10, 2026/)
    fireEvent.focus(bubble)
    expect(screen.getByLabelText('Chart value')).toHaveTextContent(/Configuration fatigue, 41 supporting reviews/)
    expect(screen.getByLabelText('Chart value').getAttribute('style')).toContain('left:')
    fireEvent.keyDown(bubble, { key: 'Enter' })
    expect(props.onThemeSelect).toHaveBeenCalledWith(theme.id)
    expect(screen.getByText('View buckets as an accessible table')).toBeInTheDocument()
    const radii = [...document.querySelectorAll<SVGCircleElement>('.voice-map-workspace__bubble-field circle')].map((circle) => Number(circle.getAttribute('r')))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(20)
    expect(Math.max(...radii)).toBeGreaterThan(65)
    const fontSizes = [...document.querySelectorAll<SVGTextElement>('.voice-map-workspace__bubble-field svg > g > g > text')].map((text) => Number.parseFloat(text.style.fontSize))
    expect(Math.max(...fontSizes) - Math.min(...fontSizes)).toBeGreaterThan(3)
    expect(Math.max(...fontSizes)).toBeGreaterThan(14)
    const emerging = screen.getByRole('button', { name: 'Confusing account choice, 1 feedback, emerging signal' })
    expect(emerging).toHaveClass('is-emerging')
    expect(emerging.querySelector('circle')).toHaveAttribute('fill', '#d7683b')
    expect(getComputedStyle(emerging.querySelector('circle')!).strokeDasharray).not.toMatch(/\d/)
    const emergingRadius = Number(emerging.querySelector('circle')?.getAttribute('r'))
    expect(screen.getAllByText('Emerging', { selector: 'td' })).toHaveLength(1)
    expect(emergingRadius).toBeLessThan(Math.max(...radii))
    expect(screen.queryByText(/needs review|withheld|unclustered/i)).not.toBeInTheDocument()
    expect(screen.getByText('Bubble size · feedback count')).toBeInTheDocument()
  })

  it('keeps long single-item labels inside small bubbles while preserving the full accessible name', () => {
    render(<PhraseBubbleMap phrases={[
      { text: 'Notificationdismissalrecovery', count: 1, themeId: 'emerging-long', themeName: 'Notification dismissal recovery', category: 'pain', state: 'emerging' },
      { text: 'Auth timeout recovery missing', count: 1, themeId: 'emerging-words', themeName: 'Auth timeout recovery missing', category: 'pain', state: 'emerging' },
      { text: 'Reliable recovery', count: 10, themeId: 'confirmed-large', themeName: 'Reliable recovery', category: 'pain' },
    ]} onSelect={vi.fn()} />)
    const bubble = screen.getByRole('button', { name: 'Notification dismissal recovery, 1 feedback, emerging signal' })
    const labelLines = [...bubble.querySelectorAll('text tspan:not(.voice-map-workspace__bubble-count)')]
    expect(labelLines.map((line) => line.textContent)).toEqual(['Notific…'])
    const wordsBubble = screen.getByRole('button', { name: 'Auth timeout recovery missing, 1 feedback, emerging signal' })
    expect([...wordsBubble.querySelectorAll('text tspan:not(.voice-map-workspace__bubble-count)')].every((line) => (line.textContent || '').length <= 8)).toBe(true)
  })

  it('uses filled, non-dashed bubbles for recurring, emerging, and user-curated signals', () => {
    render(<PhraseBubbleMap phrases={[
      { text: 'Recurring signal', count: 4, themeId: 'recurring', themeName: 'Recurring signal', category: 'pain' },
      { text: 'Emerging signal', count: 1, themeId: 'emerging', themeName: 'Emerging signal', category: 'emotion', state: 'emerging' },
      { text: 'Curated signal', count: 2, themeId: 'curated', themeName: 'Curated signal', category: 'desired_outcome', state: 'curated' },
    ]} onSelect={vi.fn()} />)
    const bubbles = [
      screen.getByRole('button', { name: /Recurring signal, 4 supporting reviews/ }),
      screen.getByRole('button', { name: 'Emerging signal, 1 feedback, emerging signal' }),
      screen.getByRole('button', { name: 'Curated signal, 2 feedback, user curated' }),
    ]
    for (const bubble of bubbles) {
      const circle = bubble.querySelector('circle')!
      expect(circle.getAttribute('fill')).not.toBe('none')
      expect(getComputedStyle(circle).strokeDasharray).not.toMatch(/\d/)
    }
  })

  it('ranks the top ten visible buckets by feedback count with a stable bucket-id tie break', () => {
    const phrases = Array.from({ length: 12 }, (_, index) => ({
      text: `Bucket ${index + 1}`,
      count: index === 10 || index === 11 ? 20 : index + 1,
      themeId: index === 10 ? 'theme-b' : index === 11 ? 'theme-a' : `theme-${String(index + 1).padStart(2, '0')}`,
      themeName: `Bucket ${index + 1}`,
      category: 'pain' as const,
    }))
    render(<PhraseBubbleMap phrases={phrases} onSelect={vi.fn()} />)

    const labels = [...document.querySelectorAll<SVGGElement>('.voice-map-workspace__bubble-field svg > g')]
      .map((node) => node.getAttribute('aria-label'))
    expect(labels).toHaveLength(10)
    expect(labels.slice(0, 4)).toEqual([
      'Bucket 12, 20 supporting reviews, pain',
      'Bucket 11, 20 supporting reviews, pain',
      'Bucket 10, 10 supporting reviews, pain',
      'Bucket 9, 9 supporting reviews, pain',
    ])
    expect(labels.some((label) => label?.startsWith('Bucket 1,'))).toBe(false)
    expect(labels.some((label) => label?.startsWith('Bucket 2,'))).toBe(false)
  })

  it('keeps timer-fallback motion active without allowing bubble overlap', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    vi.stubGlobal('cancelAnimationFrame', undefined)
    try {
      renderWorkspace()
      const nodes = [...document.querySelectorAll<SVGGElement>('.voice-map-workspace__bubble-field svg > g')]
      const before = nodes.map((node) => node.getAttribute('transform'))
      act(() => vi.advanceTimersByTime(800))
      const after = nodes.map((node) => node.getAttribute('transform'))
      expect(after.some((transform, index) => transform !== before[index])).toBe(true)

      const bodies = nodes.map((node) => {
        const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute('transform') || '')
        return { x: Number(match?.[1]), y: Number(match?.[2]), radius: Number(node.querySelector('circle')?.getAttribute('r')) }
      })
      for (let left = 0; left < bodies.length; left += 1) {
        for (let right = left + 1; right < bodies.length; right += 1) {
          expect(Math.hypot(bodies[left].x - bodies[right].x, bodies[left].y - bodies[right].y)).toBeGreaterThanOrEqual(bodies[left].radius + bodies[right].radius)
        }
      }
    } finally {
      cleanup()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('renders loading, empty, and error states without requiring data', () => {
    const { rerender } = render(<VoiceMapWorkspace mode="read" status="loading" run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} onOpenCuration={vi.fn()} />)
    expect(screen.getByText('Building the narrative from themes.')).toBeInTheDocument()
    rerender(<VoiceMapWorkspace mode="read" status="empty" run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} onOpenCuration={vi.fn()} />)
    expect(screen.getByText('There is not enough evidence yet.')).toBeInTheDocument()
    rerender(<VoiceMapWorkspace mode="read" status="error" error="Unsupported claim detected." run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} onOpenCuration={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported claim detected.')
  })
})
