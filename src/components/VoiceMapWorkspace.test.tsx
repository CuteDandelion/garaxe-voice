import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VoiceMapWorkspace, type SynthesizedVoiceMap, type VoiceMapRunSummary, type VoiceMapTheme } from './VoiceMapWorkspace'

const run: VoiceMapRunSummary = {
  id: 'run-voice-map-01', createdAt: '2026-07-12T10:00:00Z', reviewCount: 184, themeCount: 1, confidence: 'high', pipelineVersion: 'voice-map-v1',
}

const theme: VoiceMapTheme = {
  id: 'theme-setup', rank: 1, name: 'Configuration fatigue', type: 'pain_point', signalTypes: ['pain'], confidence: 'high',
  summary: 'Customers describe the cognitive cost of configuration.', representativeQuote: 'Every other solution required too much setup.',
  metrics: { reviewCount: 84, signalCount: 97, prevalence: .46, averageRating: 2.1, trend: .18, contradictionRate: .04 },
  topPhrases: [{ text: 'too much setup', count: 21 }], entityBreakdown: [{ label: 'Berlin', count: 52 }], languageBreakdown: [{ label: 'en', count: 84 }],
  evidence: [{ id: 'evidence-1', reviewId: 'review-1', quote: 'I just wanted it to work.', quoteStart: 19, quoteEnd: 44, originalText: 'After a long setup I just wanted it to work. The final result was solid.', rating: 2, provider: 'csv_import', entity: 'Berlin', language: 'en', sourceCreatedAt: '2026-06-10', sourceUrl: null, strength: .97 }],
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
    { text: 'clear onboarding', count: 3, themeId: theme.id, themeName: theme.name, category: 'praise' },
  ],
  recommendedMoves: [{ id: 'move-1', owner: 'Messaging', action: 'Lead with relief, not feature depth.', supportingThemeIds: [theme.id] }],
}

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof VoiceMapWorkspace>> = {}) {
  const props: React.ComponentProps<typeof VoiceMapWorkspace> = {
    mode: 'read', status: 'ready', run, voiceMap, themes: [theme], selectedThemeId: null,
    onModeChange: vi.fn(), onThemeSelect: vi.fn(), onThemeClose: vi.fn(), onOpenReview: vi.fn(), ...overrides,
  }
  render(<VoiceMapWorkspace {...props} />)
  return props
}

describe('VoiceMapWorkspace', () => {
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

  it('opens theme evidence from a keyboard-accessible bucket bubble and table fallback', () => {
    const props = renderWorkspace()
    const bubble = screen.getByRole('button', { name: /Configuration fatigue, 41 supporting reviews/i })
    fireEvent.keyDown(bubble, { key: 'Enter' })
    expect(props.onThemeSelect).toHaveBeenCalledWith(theme.id)
    expect(screen.getByText('View buckets as an accessible table')).toBeInTheDocument()
    const radii = [...document.querySelectorAll<SVGCircleElement>('.voice-map-workspace__bubble-field circle')].map((circle) => Number(circle.getAttribute('r')))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(20)
    expect(Math.max(...radii)).toBeGreaterThan(65)
    const fontSizes = [...document.querySelectorAll<SVGTextElement>('.voice-map-workspace__bubble-field svg > g > g > text')].map((text) => Number.parseFloat(text.style.fontSize))
    expect(Math.max(...fontSizes) - Math.min(...fontSizes)).toBeGreaterThan(3)
    expect(Math.max(...fontSizes)).toBeGreaterThan(14)
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
    const { rerender } = render(<VoiceMapWorkspace mode="read" status="loading" run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} />)
    expect(screen.getByText('Building the narrative from themes.')).toBeInTheDocument()
    rerender(<VoiceMapWorkspace mode="read" status="empty" run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} />)
    expect(screen.getByText('There is not enough evidence yet.')).toBeInTheDocument()
    rerender(<VoiceMapWorkspace mode="read" status="error" error="Unsupported claim detected." run={null} voiceMap={null} themes={[]} selectedThemeId={null} onModeChange={vi.fn()} onThemeSelect={vi.fn()} onThemeClose={vi.fn()} onOpenReview={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported claim detected.')
  })
})
