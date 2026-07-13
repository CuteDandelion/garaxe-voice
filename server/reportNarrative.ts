import type { EffectiveTheme } from './curation'
import { openCodeGoProviderFromEnv, type OpenCodeGoProvider } from './llmProvider'

export const REPORT_NARRATIVE_SCHEMA_VERSION = 'report-narrative-v1'

export type ReportAction = {
  priority: 'now' | 'next' | 'later'
  title: string
  rationale: string
  themeIds: string[]
  successMeasure: string
}

export type ReportNarrative = {
  headline: string
  executiveSummary: string
  opportunities: string[]
  risks: string[]
  actions: ReportAction[]
  provenance: {
    generator: 'llm' | 'curated_interpretations'
    schemaVersion: string
    provider: string | null
    model: string | null
    generatedAt: string
  }
}

type NarrativeInput = { projectName: string; objective: string; themes: EffectiveTheme[] }

function concise(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function fallbackNarrative(input: NarrativeInput, generatedAt: string): ReportNarrative {
  const ranked = [...input.themes].sort((left, right) => left.rank - right.rank)
  const first = ranked[0]
  const pain = ranked.filter((theme) => theme.sentiment === 'negative' || theme.type === 'pain')
  const positive = ranked.filter((theme) => theme.sentiment === 'positive' || theme.type === 'outcome')
  return {
    headline: first?.name || 'Customer evidence requires review',
    executiveSummary: ranked.slice(0, 3).map((theme) => theme.summary).filter(Boolean).join(' ') || 'No approved interpretation was available.',
    opportunities: positive.slice(0, 3).map((theme) => theme.summary),
    risks: pain.slice(0, 3).map((theme) => theme.summary),
    actions: ranked.slice(0, 3).map((theme, index) => ({
      priority: index === 0 ? 'now' : index === 1 ? 'next' : 'later',
      title: `Respond to ${theme.name}`,
      rationale: theme.summary,
      themeIds: [theme.id],
      successMeasure: `Track the share of feedback associated with ${theme.name.toLowerCase()} in the next analysis run.`,
    })),
    provenance: { generator: 'curated_interpretations', schemaVersion: REPORT_NARRATIVE_SCHEMA_VERSION, provider: null, model: null, generatedAt },
  }
}

function parseNarrative(raw: string, input: NarrativeInput, generatedAt: string, model: string): ReportNarrative {
  const value = JSON.parse(raw) as Record<string, unknown>
  const themeIds = new Set(input.themes.map((theme) => theme.id))
  const list = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map((item) => concise(item, 280)).filter(Boolean).slice(0, 4)
    : []
  const actions = Array.isArray(value.actions) ? value.actions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const action = candidate as Record<string, unknown>
    const cited = Array.isArray(action.themeIds)
      ? action.themeIds.filter((id): id is string => typeof id === 'string' && themeIds.has(id)).slice(0, 4)
      : []
    const title = concise(action.title, 120)
    const rationale = concise(action.rationale, 360)
    const successMeasure = concise(action.successMeasure, 240)
    if (!title || !rationale || !successMeasure || cited.length === 0) return []
    const priority = action.priority === 'next' || action.priority === 'later' ? action.priority : 'now'
    return [{ priority, title, rationale, themeIds: cited, successMeasure } satisfies ReportAction]
  }).slice(0, 5) : []
  const headline = concise(value.headline, 160)
  const executiveSummary = concise(value.executiveSummary, 1_200)
  if (!headline || !executiveSummary || actions.length === 0) throw new Error('Report narrative did not satisfy the evidence contract.')
  return {
    headline,
    executiveSummary,
    opportunities: list(value.opportunities),
    risks: list(value.risks),
    actions,
    provenance: { generator: 'llm', schemaVersion: REPORT_NARRATIVE_SCHEMA_VERSION, provider: 'opencode_go', model, generatedAt },
  }
}

function prompt(input: NarrativeInput) {
  const themes = input.themes.map((theme) => ({
    id: theme.id,
    rank: theme.rank,
    name: theme.name,
    summary: theme.summary,
    type: theme.type,
    sentiment: theme.sentiment,
    confidence: theme.confidence,
    evidence: theme.evidence.filter((item) => !item.excluded).slice(0, 4).map((item) => ({ reviewId: item.reviewId, quote: item.quote })),
  }))
  return [
    { role: 'system' as const, content: 'You are an evidence-first customer research editor. Return compact JSON only. Never invent facts, metrics, actions, or citations. Every action must cite one or more supplied theme IDs.' },
    { role: 'user' as const, content: JSON.stringify({
      task: 'Create a concise executive brief for a business leader. Use plain language. Keep the whole response short and precise.',
      output: { headline: 'string', executiveSummary: 'max 180 words', opportunities: ['max 4'], risks: ['max 4'], actions: [{ priority: 'now|next|later', title: 'string', rationale: 'string', themeIds: ['supplied IDs only'], successMeasure: 'observable measure' }] },
      project: input.projectName,
      objective: input.objective,
      themes,
    }) },
  ]
}

export async function generateReportNarrative(
  input: NarrativeInput,
  options: { provider?: OpenCodeGoProvider | null; environment?: NodeJS.ProcessEnv; generatedAt?: string } = {},
) {
  const generatedAt = options.generatedAt || new Date().toISOString()
  const environment = options.environment || process.env
  const provider = options.provider === undefined ? openCodeGoProviderFromEnv(environment) : options.provider
  const model = environment.GARAXE_REPORT_LLM_MODEL || environment.OPENCODE_GO_DEFAULT_MODEL || 'qwen3.7-plus'
  if (!provider || environment.GARAXE_REPORT_LLM_ENABLED === 'false') return fallbackNarrative(input, generatedAt)
  try {
    const completion = await provider.complete({ model, messages: prompt(input), maxTokens: 1_200, temperature: 0, json: true, enableThinking: false })
    return parseNarrative(completion.content, input, generatedAt, completion.model)
  } catch {
    return fallbackNarrative(input, generatedAt)
  }
}
