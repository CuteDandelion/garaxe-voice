import type { EffectiveTheme } from './curation'
import { openCodeGoProviderFromEnv, type OpenCodeGoProvider } from './llmProvider'

export const OVERVIEW_BRIEF_SCHEMA_VERSION = 'overview-intelligence-v1'

export type OverviewBriefItem = { title: string; narrative: string; themeIds: string[] }
export type OverviewNextAction = { title: string; rationale: string; themeIds: string[] }
export type OverviewBrief = {
  understood: OverviewBriefItem
  majorOpportunity: OverviewBriefItem | null
  majorRisk: OverviewBriefItem | null
  salesImplications: OverviewBriefItem[]
  marketingImplications: OverviewBriefItem[]
  nextActions: OverviewNextAction[]
}
export type OverviewBriefResult = {
  status: 'ready' | 'evidence_only'
  schemaVersion: typeof OVERVIEW_BRIEF_SCHEMA_VERSION
  brief: OverviewBrief | null
  message?: string
}

const concise = (value: unknown, maximum: number) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''

function parseItem(value: unknown, themeIds: Set<string>, narrativeKey: 'narrative' | 'rationale' = 'narrative') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Overview brief item is invalid.')
  const item = value as Record<string, unknown>
  const title = concise(item.title, 140)
  const narrative = concise(item[narrativeKey], 420)
  const cited = Array.isArray(item.themeIds)
    ? [...new Set(item.themeIds.filter((id): id is string => typeof id === 'string' && themeIds.has(id)))].slice(0, 4)
    : []
  if (!title || !narrative || cited.length === 0) throw new Error('Overview brief item is not grounded.')
  return { title, [narrativeKey]: narrative, themeIds: cited }
}

function parseBrief(raw: string, themes: EffectiveTheme[]): OverviewBrief {
  const value = JSON.parse(raw) as Record<string, unknown>
  const ids = new Set(themes.map((theme) => theme.id))
  const list = (candidate: unknown, maximum: number, minimum = 0) => {
    if (!Array.isArray(candidate) || candidate.length < minimum) throw new Error('Overview brief list is invalid.')
    return candidate.slice(0, maximum).map((item) => parseItem(item, ids) as OverviewBriefItem)
  }
  const nextActions = Array.isArray(value.nextActions)
    ? value.nextActions.slice(0, 5).map((item) => parseItem(item, ids, 'rationale') as OverviewNextAction)
    : []
  if (nextActions.length < 3) throw new Error('Overview brief requires three grounded actions.')
  return {
    understood: parseItem(value.understood, ids) as OverviewBriefItem,
    majorOpportunity: value.majorOpportunity === null ? null : parseItem(value.majorOpportunity, ids) as OverviewBriefItem,
    majorRisk: value.majorRisk === null ? null : parseItem(value.majorRisk, ids) as OverviewBriefItem,
    salesImplications: list(value.salesImplications, 1, 1),
    marketingImplications: list(value.marketingImplications, 1, 1),
    nextActions,
  }
}

function messages(themes: EffectiveTheme[]) {
  const buckets = themes.map((theme) => ({
    id: theme.id,
    topic: theme.topic,
    label: theme.name,
    category: theme.categories[0] || theme.type,
    sentiment: theme.sentiment,
    summary: theme.summary,
    evidence: theme.evidence.filter((item) => !item.excluded).slice(0, 4).map((item) => ({ reviewId: item.reviewId, quote: item.quote })),
  }))
  return [
    { role: 'system' as const, content: 'You are the Voice Lab intelligence editor. Return compact JSON only. Summarize and advise from supplied evidence; never change inclusion, counts, ranking, grouping, categories, or citations. Every claim and action must cite supplied bucket IDs.' },
    { role: 'user' as const, content: JSON.stringify({
      task: 'Create a concise executive intelligence brief over this saved Voice Map outcome. Separate what was understood, the major opportunity and risk, exactly 1 sales implication, exactly 1 marketing implication, and exactly 3 next actions. Keep each title under 8 words and each narrative or rationale under 35 words. Use plain language.',
      output: {
        understood: { title: 'string', narrative: 'string', themeIds: ['supplied IDs only'] },
        majorOpportunity: 'same item or null', majorRisk: 'same item or null',
        salesImplications: [{ title: 'string', narrative: 'string', themeIds: ['supplied IDs only'] }],
        marketingImplications: [{ title: 'string', narrative: 'string', themeIds: ['supplied IDs only'] }],
        nextActions: [{ title: 'string', rationale: 'string', themeIds: ['supplied IDs only'] }],
      },
      buckets,
    }) },
  ]
}

const evidenceOnly = (): OverviewBriefResult => ({
  status: 'evidence_only', schemaVersion: OVERVIEW_BRIEF_SCHEMA_VERSION, brief: null,
  message: 'The intelligence brief is unavailable. Evidence context remains available.',
})

export async function generateOverviewBrief(
  themes: EffectiveTheme[],
  options: { provider?: OpenCodeGoProvider | null; environment?: NodeJS.ProcessEnv } = {},
): Promise<OverviewBriefResult> {
  const usable = themes.filter((theme) => !['consumed', 'rejected', 'not_reviewable'].includes(theme.status) && theme.evidence.some((item) => !item.excluded))
  if (usable.length === 0) return evidenceOnly()
  const environment = options.environment || process.env
  const provider = options.provider === undefined ? openCodeGoProviderFromEnv(environment) : options.provider
  if (!provider || environment.GARAXE_OVERVIEW_LLM_ENABLED === 'false') return evidenceOnly()
  try {
    const completion = await provider.complete({
      model: environment.GARAXE_OVERVIEW_LLM_MODEL || environment.OPENCODE_GO_DEFAULT_MODEL || 'qwen3.7-plus',
      messages: messages(usable), maxTokens: 1_800, temperature: 0, json: true, enableThinking: false,
    })
    return { status: 'ready', schemaVersion: OVERVIEW_BRIEF_SCHEMA_VERSION, brief: parseBrief(completion.content, usable) }
  } catch {
    return evidenceOnly()
  }
}
