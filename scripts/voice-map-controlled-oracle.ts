import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export type ActionableCategory =
  | 'pain'
  | 'desired_outcome'
  | 'objection'
  | 'emotion'
  | 'other'

export type ControlledFixtureItem = {
  id: string
  text: string
  quote: string
  categories: ActionableCategory[]
  group?: string
  emerging?: boolean
}

export const controlledFixture: ControlledFixtureItem[] = [
  { id: 'controlled-01', text: 'The export froze at 90%, so I could not deliver the report on time.', quote: 'export froze at 90%', categories: ['pain'], group: 'export_stall' },
  { id: 'controlled-02', text: 'The export froze at 90%, so I could not deliver the report on time.', quote: 'export froze at 90%', categories: ['pain'], group: 'export_stall' },
  { id: 'controlled-03', text: 'Report export stalled near completion and left the delivery unfinished.', quote: 'export stalled near completion', categories: ['pain'], group: 'export_stall' },
  { id: 'controlled-04', text: 'Finishing an export hangs at the last step, preventing me from sharing results.', quote: 'export hangs at the last step', categories: ['pain'], group: 'export_stall' },
  { id: 'controlled-05', text: 'I want to finish initial setup without guessing which step comes next.', quote: 'finish initial setup without guessing', categories: ['desired_outcome'], group: 'guided_setup' },
  { id: 'controlled-06', text: 'A clear onboarding path would help me complete setup confidently.', quote: 'complete setup confidently', categories: ['desired_outcome'], group: 'guided_setup' },
  { id: 'controlled-07', text: 'During onboarding, I need to understand my progress and next action.', quote: 'understand my progress and next action', categories: ['desired_outcome'], group: 'guided_setup' },
  { id: 'controlled-08', text: 'Clear onboarding milestones would make initial configuration easier to complete.', quote: 'Clear onboarding milestones', categories: ['desired_outcome'], group: 'guided_setup' },
  { id: 'controlled-09', text: 'I am hesitant to migrate because I might lose historical customer notes.', quote: 'hesitant to migrate', categories: ['objection'], group: 'migration_risk' },
  { id: 'controlled-10', text: 'Before switching, I need proof that the migration preserves every customer note.', quote: 'need proof that the migration preserves every customer note', categories: ['objection'], group: 'migration_risk' },
  { id: 'controlled-11', text: 'The risk of losing account history makes me reluctant to move from our current tool.', quote: 'risk of losing account history', categories: ['objection'], group: 'migration_risk' },
  { id: 'controlled-12', text: 'I feel anxious when a save finishes without any confirmation.', quote: 'feel anxious', categories: ['emotion'], group: 'save_anxiety' },
  { id: 'controlled-13', text: 'Missing save confirmation makes me nervous that my work disappeared.', quote: 'makes me nervous', categories: ['emotion'], group: 'save_anxiety' },
  { id: 'controlled-14', text: 'I worry about losing changes whenever the save status is silent.', quote: 'worry about losing changes', categories: ['emotion'], group: 'save_anxiety' },
  { id: 'controlled-15', text: 'The invoice total changes after tax with no explanation, which makes billing confusing.', quote: 'invoice total changes after tax with no explanation', categories: ['pain'], group: 'billing_clarity' },
  { id: 'controlled-16', text: 'Unexpected tax adjustments make the final invoice difficult to understand.', quote: 'final invoice difficult to understand', categories: ['pain'], group: 'billing_clarity' },
  { id: 'controlled-17', text: 'I need the mobile navigation to keep project search visible while scrolling.', quote: 'keep project search visible', categories: ['desired_outcome'], group: 'mobile_navigation' },
  { id: 'controlled-18', text: 'Please keep search accessible in the mobile header instead of hiding it in a menu.', quote: 'keep search accessible in the mobile header', categories: ['desired_outcome'], group: 'mobile_navigation' },
  { id: 'controlled-19', text: 'The password reset link expired before the email arrived.', quote: 'password reset link expired', categories: ['pain'], emerging: true },
  { id: 'controlled-20', text: 'I want invoice PDFs to include the purchase order number.', quote: 'invoice PDFs to include the purchase order number', categories: ['desired_outcome'], emerging: true },
  { id: 'controlled-21', text: 'I would not sign an annual contract without a clear cancellation window.', quote: 'not sign an annual contract without a clear cancellation window', categories: ['objection'], emerging: true },
  { id: 'controlled-22', text: 'Deleting a workspace without a preview makes me anxious about removing the wrong data.', quote: 'makes me anxious', categories: ['emotion'], emerging: true },
  { id: 'controlled-23', text: 'Please add a keyboard shortcut that opens the evidence drawer.', quote: 'keyboard shortcut that opens the evidence drawer', categories: ['desired_outcome'], emerging: true },
  { id: 'controlled-24', text: 'Weekend support hours are unclear when an urgent import fails.', quote: 'Weekend support hours are unclear', categories: ['pain'], emerging: true },
  { id: 'controlled-25', text: 'Support replied quickly, but the answer did not explain how to repair the broken import.', quote: 'did not explain how to repair the broken import', categories: ['pain'], emerging: true },
  { id: 'controlled-26', text: 'Autosave would reduce lost work, although I need assurance that drafts remain private.', quote: 'need assurance that drafts remain private', categories: ['objection'], emerging: true },
  { id: 'controlled-27', text: 'I felt relieved when the refund arrived, but the unexplained delay still worries me.', quote: 'unexplained delay still worries me', categories: ['emotion'], emerging: true },
  { id: 'controlled-28', text: 'The dashboard becomes slow only when a project contains thousands of comments.', quote: 'dashboard becomes slow', categories: ['pain'], emerging: true },
  { id: 'controlled-29', text: 'I am unsure whether the trial price will increase when I invite a second analyst.', quote: 'unsure whether the trial price will increase', categories: ['objection'], emerging: true },
  { id: 'controlled-30', text: 'I want color labels to include text so the status remains understandable without color.', quote: 'color labels to include text', categories: ['desired_outcome'], emerging: true },
]

export const praiseRubricCases = [
  {
    id: 'achieved-value-praise',
    text: 'I appreciated seeing exactly what changed because the progress update removed uncertainty.',
    quote: 'progress update removed uncertainty',
    expectedCategory: 'desired_outcome' as const,
    expectedSignalType: 'desired_outcome' as const,
    expectedSentiment: 'positive' as const,
  },
  {
    id: 'affective-praise',
    text: 'The clear milestone update was excellent and made the whole process feel calm.',
    quote: 'made the whole process feel calm',
    expectedCategory: 'emotion' as const,
    expectedSignalType: 'emotion' as const,
    expectedSentiment: 'positive' as const,
  },
] as const

export const malformedInputExpectations = [
  { name: 'blank feedback', input: '   ', expected: 'Reject before analysis with an explicit empty-input reason; do not retain or chart it.' },
  { name: 'missing review text', input: { review_id: 'malformed-01' }, expected: 'Reject before analysis with an explicit missing-text reason; do not retain or chart it.' },
] as const

// Keeps every expected recurrence group inside one 10-item demo run.
export const controlledDemoRunIds = [
  ['controlled-01', 'controlled-02', 'controlled-03', 'controlled-04', 'controlled-05', 'controlled-06', 'controlled-07', 'controlled-08', 'controlled-19', 'controlled-20'],
  ['controlled-09', 'controlled-10', 'controlled-11', 'controlled-12', 'controlled-13', 'controlled-14', 'controlled-15', 'controlled-16', 'controlled-17', 'controlled-18'],
  ['controlled-21', 'controlled-22', 'controlled-23', 'controlled-24', 'controlled-25', 'controlled-26', 'controlled-27', 'controlled-28', 'controlled-29', 'controlled-30'],
] as const

export const balancedCategoryDemoRunIds = [
  'controlled-15', 'controlled-16',
  'controlled-05', 'controlled-06',
  'controlled-09', 'controlled-10',
  'controlled-12', 'controlled-13',
] as const

export const balancedCategoryFixture = balancedCategoryDemoRunIds.map((id) => controlledFixture.find((item) => item.id === id)!)

type CoverageSignal = {
  label?: string
  aspect?: string
  topic?: string | null
  signalType?: string
  signalTypes?: string[]
  sentiment?: string
  category?: string
  categories?: string[]
  quote?: string
  interpretedBy?: string
}

export type ControlledCoverageItem = {
  reviewId?: string
  originalText?: string
  disposition?: string
  themeIds?: string[]
  signals?: CoverageSignal[]
}

const genericLabel = /insufficient validated evidence|unclustered feedback|customers discuss|unrelated (?:feedback|feature requests?)/i

const groupMembers = (coverageByFixtureId: Map<string, ControlledCoverageItem>, group: string) =>
  controlledFixture.filter((item) => item.group === group).map((item) => coverageByFixtureId.get(item.id)!)

const commonThemeIds = (items: ControlledCoverageItem[]) => {
  const [first, ...rest] = items
  return new Set((first.themeIds || []).filter((id) => rest.every((item) => item.themeIds?.includes(id))))
}

export function validateControlledCoverage(coverage: ControlledCoverageItem[]) {
  if (coverage.length !== controlledFixture.length) {
    throw new Error(`Coverage must contain exactly ${controlledFixture.length} retained feedback items; received ${coverage.length}.`)
  }

  const fixtureQueuesByText = new Map<string, ControlledFixtureItem[]>()
  for (const item of controlledFixture) {
    fixtureQueuesByText.set(item.text, [...(fixtureQueuesByText.get(item.text) || []), item])
  }
  const coverageByFixtureId = new Map<string, ControlledCoverageItem>()
  let exactQuotes = 0
  let categoryMatches = 0

  for (const result of coverage) {
    const text = result.originalText || ''
    const expected = fixtureQueuesByText.get(text)?.shift()
    if (!expected) throw new Error('Coverage contains an unknown source comment or too many copies of one comment.')
    coverageByFixtureId.set(expected.id, result)

    const signals = result.signals || []
    if (signals.some((signal) => genericLabel.test(signal.label || ''))) {
      throw new Error(`Coverage uses a generic label instead of an actionable category for ${expected.id}.`)
    }

    const groundedSignal = signals.find((signal) => {
      const quote = signal.quote || ''
      return signal.interpretedBy === 'analysis_engine'
        && quote.length > 0
        && text.includes(quote)
    })
    if (!groundedSignal) {
      throw new Error(`Coverage lacks an engine-categorized exact source quote for ${expected.id}.`)
    }
    const expectedCategory = expected.categories[0]
    const receivedCategory = groundedSignal.category || '<missing>'
    if (receivedCategory !== expectedCategory) {
      throw new Error(`${expected.id} expected ${expectedCategory}, received ${receivedCategory}.`)
    }
    exactQuotes += 1
    categoryMatches += 1
  }

  for (const expected of controlledFixture) {
    if (!coverageByFixtureId.has(expected.id)) throw new Error(`Coverage silently dropped ${expected.id}.`)
    const result = coverageByFixtureId.get(expected.id)!
    if (expected.emerging && result.disposition !== 'emerging') {
      const themeIds = new Set(result.themeIds || [])
      const members = [...coverageByFixtureId.entries()].filter(([, item]) => item.themeIds?.some((themeId) => themeIds.has(themeId)))
        .map(([id, item]) => ({
          id,
          labels: item.signals?.filter((signal) => signal.interpretedBy === 'analysis_engine').map((signal) => signal.label) || [],
          aspects: item.signals?.filter((signal) => signal.interpretedBy === 'analysis_engine').map((signal) => signal.aspect) || [],
          categories: item.signals?.flatMap((signal) => signal.categories || []) || [],
        }))
      throw new Error(`Unique valid feedback ${expected.id} must remain an emerging signal, not a confirmed recurrence: ${JSON.stringify(members)}.`)
    }
  }

  const groups = [...new Set(controlledFixture.flatMap((item) => item.group ? [item.group] : []))]
  const themesByGroup = new Map<string, Set<string>>()
  for (const group of groups) {
    const members = groupMembers(coverageByFixtureId, group)
    const sharedThemes = commonThemeIds(members)
    if (sharedThemes.size === 0) {
      const diagnostics = controlledFixture.filter((item) => item.group === group).map((item, index) => ({
        id: item.id,
        labels: members[index].signals?.filter((signal) => signal.interpretedBy === 'analysis_engine').map((signal) => signal.label),
        aspects: members[index].signals?.filter((signal) => signal.interpretedBy === 'analysis_engine').map((signal) => signal.aspect),
        categories: members[index].signals?.flatMap((signal) => signal.categories || []),
        themeIds: members[index].themeIds,
      }))
      throw new Error(`Expected merge group ${group} does not share a theme: ${JSON.stringify(diagnostics)}.`)
    }
    themesByGroup.set(group, sharedThemes)
  }

  for (const [left, right] of [['export_stall', 'billing_clarity'], ['guided_setup', 'mobile_navigation']] as const) {
    const leftThemes = themesByGroup.get(left)!
    const rightThemes = themesByGroup.get(right)!
    if ([...leftThemes].some((id) => rightThemes.has(id))) {
      throw new Error(`Expected separate topic groups ${left} and ${right} were merged.`)
    }
  }

  return { covered: coverageByFixtureId.size, exactQuotes, categoryMatches }
}

export function validateBalancedCategoryCoverage(coverage: ControlledCoverageItem[]) {
  const expectedByText = new Map(balancedCategoryFixture.map((item) => [item.text, item]))
  const resultById = new Map<string, ControlledCoverageItem>()
  const categoryCounts = { pain: 0, desired_outcome: 0, objection: 0, emotion: 0 }

  for (const result of coverage) {
    const expected = expectedByText.get(result.originalText || '')
    if (!expected || resultById.has(expected.id)) throw new Error('Balanced category coverage contains an unknown or duplicate source comment.')
    const signal = (result.signals || []).find((item) => item.interpretedBy === 'analysis_engine'
      && Boolean(item.quote) && expected.text.includes(item.quote!))
    if (!signal) throw new Error(`${expected.id} lacks an exact engine-grounded category.`)
    const expectedCategory = expected.categories[0] as keyof typeof categoryCounts
    const received = signal.category || signal.signalType || '<missing>'
    if (received !== expectedCategory) throw new Error(`${expected.id} expected ${expectedCategory}, received ${received}.`)
    categoryCounts[expectedCategory] += 1
    resultById.set(expected.id, result)
  }

  for (const expected of balancedCategoryFixture) {
    if (!resultById.has(expected.id)) throw new Error(`${expected.id} is missing from balanced category coverage.`)
  }
  for (const group of new Set(balancedCategoryFixture.map((item) => item.group!))) {
    const members = balancedCategoryFixture.filter((item) => item.group === group).map((item) => resultById.get(item.id)!)
    if (commonThemeIds(members).size === 0) throw new Error(`${group} has the right category but incorrect supporting IDs/count.`)
  }

  return { covered: resultById.size, categoryCounts }
}

export function validatePraiseRubricCoverage(coverage: ControlledCoverageItem[]) {
  const byText = new Map<string, typeof praiseRubricCases[number]>(praiseRubricCases.map((item) => [item.text, item]))
  let positive = 0
  for (const result of coverage) {
    const expected = byText.get(result.originalText || '')
    if (!expected) continue
    const signal = (result.signals || []).find((item) => item.interpretedBy === 'analysis_engine'
      && Boolean(item.quote) && expected.text.includes(item.quote!))
    if (!signal) throw new Error(`${expected.id} lacks an exact engine-grounded praise signal.`)
    if (signal.category !== expected.expectedCategory) {
      throw new Error(`${expected.id} expected ${expected.expectedCategory}, received ${signal.category || '<missing>'}.`)
    }
    if (!new Set([signal.signalType, ...(signal.signalTypes || [])]).has(expected.expectedSignalType)) {
      throw new Error(`${expected.id} expected ${expected.expectedSignalType} semantic type.`)
    }
    if (signal.sentiment !== expected.expectedSentiment) {
      throw new Error(`${expected.id} expected ${expected.expectedSentiment} sentiment, received ${signal.sentiment || '<missing>'}.`)
    }
    positive += 1
    byText.delete(expected.text)
  }
  if (byText.size) throw new Error(`Praise rubric is missing ${[...byText.values()].map((item) => item.id).join(', ')}.`)
  return { covered: praiseRubricCases.length, positive }
}

const unwrapCoverage = (value: unknown): ControlledCoverageItem[] => {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') throw new Error('Expected a coverage array or an object containing coverage.')
  const record = value as Record<string, unknown>
  if (Array.isArray(record.coverage)) return record.coverage
  if (record.data && typeof record.data === 'object') return unwrapCoverage(record.data)
  throw new Error('Expected a coverage array or an object containing coverage.')
}

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: npx tsx scripts/voice-map-controlled-oracle.ts <coverage.json>')
  const result = validateControlledCoverage(unwrapCoverage(JSON.parse(await readFile(path, 'utf8'))))
  console.log(JSON.stringify({ status: 'pass', ...result }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Controlled coverage validation failed.')
    process.exitCode = 1
  })
}
