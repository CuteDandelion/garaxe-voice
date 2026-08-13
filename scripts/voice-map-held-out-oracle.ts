export type HeldOutCategory = 'pain' | 'desired_outcome' | 'objection' | 'emotion' | 'other'

export type HeldOutFixtureItem = {
  id: string
  text: string
  quote: string
  sourceUrl: string
  expectedCategory: HeldOutCategory
  topic: string
  topicCues: string[]
  group?: string
}

// Public issue feedback, paraphrased and stripped of usernames. This corpus is
// held out from the controlled-30 regression and carries a human-authored rubric.
export const heldOutFixture: HeldOutFixtureItem[] = [
  { id: 'heldout-01', text: 'When a long conversation reaches the context limit, the thread can fail and I lose the work in progress.', quote: 'thread can fail', sourceUrl: 'https://github.com/openai/codex/issues/7808', expectedCategory: 'pain', topic: 'context loss', topicCues: ['context', 'thread', 'conversation'], group: 'context_loss' },
  { id: 'heldout-02', text: 'Running out of context ended the active chat instead of preserving enough state to continue.', quote: 'ended the active chat', sourceUrl: 'https://github.com/openai/codex/issues/7808', expectedCategory: 'pain', topic: 'context loss', topicCues: ['context', 'chat', 'conversation'], group: 'context_loss' },
  { id: 'heldout-03', text: 'I want visible compile and upload progress so I can tell whether the board upload is still moving.', quote: 'visible compile and upload progress', sourceUrl: 'https://github.com/microsoft/vscode-arduino/issues/1621', expectedCategory: 'desired_outcome', topic: 'compile progress', topicCues: ['compile', 'upload', 'progress'], group: 'compile_progress' },
  { id: 'heldout-04', text: 'Please show build progress separately from logs so an upload timeout is not the first sign that it stalled.', quote: 'show build progress separately from logs', sourceUrl: 'https://github.com/microsoft/vscode-arduino/issues/1621', expectedCategory: 'desired_outcome', topic: 'compile progress', topicCues: ['build', 'upload', 'progress'], group: 'compile_progress' },
  { id: 'heldout-05', text: 'I would not adopt remote development if the app can write to my local computer without explicit permission.', quote: 'would not adopt remote development', sourceUrl: 'https://github.com/openai/codex/issues/10450', expectedCategory: 'objection', topic: 'local write permission barrier', topicCues: ['remote', 'local', 'permission'] },
  { id: 'heldout-06', text: 'Before switching to remote workspaces, I need the remote checkout to be the sole source of truth with no local sync workaround.', quote: 'Before switching to remote workspaces', sourceUrl: 'https://github.com/openai/codex/issues/10450', expectedCategory: 'objection', topic: 'remote checkout source of truth', topicCues: ['remote', 'checkout', 'workspace'] },
  { id: 'heldout-07', text: 'I feel frustrated when a command freezes for forty minutes with no response or error.', quote: 'feel frustrated', sourceUrl: 'https://github.com/openai/codex/issues/3373', expectedCategory: 'emotion', topic: 'command freeze frustration', topicCues: ['freeze', 'command', 'response'] },
  { id: 'heldout-08', text: 'A silent embedded shell makes me anxious because I cannot tell whether the task is running or lost.', quote: 'makes me anxious', sourceUrl: 'https://github.com/openai/codex/issues/3373', expectedCategory: 'emotion', topic: 'silent shell anxiety', topicCues: ['shell', 'status', 'running'] },
  { id: 'heldout-09', text: 'I want each conversation to choose ChatGPT, Work Agent, or Codex mode without switching the whole application.', quote: 'each conversation to choose', sourceUrl: 'https://github.com/openai/codex/issues/35158', expectedCategory: 'desired_outcome', topic: 'per-conversation model selection', topicCues: ['conversation', 'model', 'mode'] },
  { id: 'heldout-10', text: 'Please keep normal chat and coding conversations open side by side instead of changing the application mode globally.', quote: 'conversations open side by side', sourceUrl: 'https://github.com/openai/codex/issues/35158', expectedCategory: 'desired_outcome', topic: 'side-by-side chat layout', topicCues: ['chat', 'layout', 'side'] },
  { id: 'heldout-11', text: 'Activity bar icons are hard to understand when a new user has never seen them before.', quote: 'icons are hard to understand', sourceUrl: 'https://github.com/microsoft/vscode/issues/115641', expectedCategory: 'pain', topic: 'activity bar icon clarity', topicCues: ['activity', 'icon'] },
  { id: 'heldout-12', text: 'New users struggle to discover the command palette and integrated terminal from the current navigation.', quote: 'struggle to discover', sourceUrl: 'https://github.com/microsoft/vscode/issues/115641', expectedCategory: 'pain', topic: 'command and terminal discovery', topicCues: ['discover', 'navigation', 'terminal'] },
  { id: 'heldout-13', text: 'I want typed issue fields so priority and team data stay consistent across repositories.', quote: 'typed issue fields', sourceUrl: 'https://github.com/orgs/community/discussions/189141', expectedCategory: 'desired_outcome', topic: 'structured issue fields', topicCues: ['issue', 'field', 'priority'], group: 'issue_fields' },
  { id: 'heldout-14', text: 'Please add reusable structured fields with validation so issue metadata can be reported reliably.', quote: 'structured fields with validation', sourceUrl: 'https://github.com/orgs/community/discussions/189141', expectedCategory: 'desired_outcome', topic: 'structured issue fields', topicCues: ['issue', 'field', 'metadata'], group: 'issue_fields' },
  { id: 'heldout-15', text: 'The word spawn made the virtual-environment workflow confusing because I expected a separate terminal window.', quote: 'workflow confusing', sourceUrl: 'https://github.com/python-poetry/poetry/issues/2792', expectedCategory: 'pain', topic: 'virtual environment terminology', topicCues: ['virtual', 'environment', 'spawn'] },
  { id: 'heldout-16', text: 'I want built-in speech transcription so I do not need to leave the subtitle editor for Whisper support.', quote: 'built-in speech transcription', sourceUrl: 'https://github.com/TypesettingTools/Aegisub/issues/293', expectedCategory: 'desired_outcome', topic: 'speech transcription', topicCues: ['speech', 'transcription', 'whisper'] },
  { id: 'heldout-17', text: 'Forced automatic compaction makes me afraid the agent will continue outside my carefully prepared instructions.', quote: 'makes me afraid', sourceUrl: 'https://github.com/openai/codex/issues/4363', expectedCategory: 'emotion', topic: 'automatic compaction fear', topicCues: ['compact', 'context', 'instruction'] },
  { id: 'heldout-18', text: 'I would not trust the agent for planning until it can discuss a request without immediately editing files.', quote: 'would not trust the agent', sourceUrl: 'https://github.com/openai/codex/issues/2101', expectedCategory: 'objection', topic: 'unintended edit barrier', topicCues: ['plan', 'edit', 'change'] },
  { id: 'heldout-19', text: 'Finding the executable among dozens of bundled files is frustrating and makes the application harder to launch.', quote: 'Finding the executable', sourceUrl: 'https://github.com/pyinstaller/pyinstaller/issues/5575', expectedCategory: 'pain', topic: 'bundled executable discovery', topicCues: ['executable', 'bundle', 'file'] },
  { id: 'heldout-20', text: 'I need to recover access to a phone even when its screen and touch input are both broken.', quote: 'recover access to a phone', sourceUrl: 'https://github.com/Genymobile/scrcpy/issues/4718', expectedCategory: 'desired_outcome', topic: 'broken phone recovery', topicCues: ['recover', 'phone', 'screen'] },
]

export const heldOutDemoRunIds = [
  heldOutFixture.slice(0, 10).map((item) => item.id),
  heldOutFixture.slice(10, 20).map((item) => item.id),
] as const

export type HeldOutCoverageItem = {
  reviewId?: string
  originalText?: string
  disposition?: string
  themeIds?: string[]
  signals: Array<{
    label?: string
    topic?: string
    aspect?: string
    signalType?: string
    signalTypes?: string[]
    category?: string
    categories?: string[]
    quote?: string
    interpretedBy?: string
  }>
}

export type HeldOutQualityResult = {
  total: number
  covered: number
  exactQuotes: number
  categoryCorrect: number
  topicCorrect: number
  falseMergePairs: number
  missedMergePairs: number
  topicCoherence: number
  failures: string[]
}

const sharesTheme = (left?: string[], right?: string[]) =>
  (left || []).some((themeId) => right?.includes(themeId))

export function evaluateHeldOutCoverage(coverage: HeldOutCoverageItem[]): HeldOutQualityResult {
  const failures: string[] = []
  const expectedByText = new Map(heldOutFixture.map((item) => [item.text, item]))
  const coverageById = new Map<string, HeldOutCoverageItem>()
  let exactQuotes = 0
  let categoryCorrect = 0
  let topicCorrect = 0

  for (const result of coverage) {
    const expected = expectedByText.get(result.originalText || '')
    if (!expected) {
      failures.push(`Coverage contains an unknown or duplicate source comment: ${result.originalText || '<missing text>'}`)
      continue
    }
    if (coverageById.has(expected.id)) {
      failures.push(`${expected.id} appears more than once in coverage`)
      continue
    }
    coverageById.set(expected.id, result)
    const signal = result.signals.find((item) => item.interpretedBy === 'analysis_engine'
      && Boolean(item.quote) && expected.text.includes(item.quote!))
    if (!signal) {
      failures.push(`${expected.id} has no exact engine-grounded quote`)
      continue
    }
    exactQuotes += 1
    if (signal.category === expected.expectedCategory) categoryCorrect += 1
    else failures.push(`${expected.id} category expected ${expected.expectedCategory}, received ${signal.category || '<missing>'}`)

    const topicText = `${signal.label || ''} ${signal.topic || signal.aspect || ''}`.toLowerCase()
    if (expected.topicCues.some((cue) => topicText.includes(cue))) topicCorrect += 1
    else failures.push(`${expected.id} topic is incoherent with ${expected.topic}`)
  }

  for (const expected of heldOutFixture) {
    if (!coverageById.has(expected.id)) failures.push(`${expected.id} is missing from coverage`)
  }

  let falseMergePairs = 0
  let missedMergePairs = 0
  let coherentMergedPairs = 0
  let mergedPairs = 0
  for (let leftIndex = 0; leftIndex < heldOutFixture.length; leftIndex += 1) {
    const leftExpected = heldOutFixture[leftIndex]
    const left = coverageById.get(leftExpected.id)
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < heldOutFixture.length; rightIndex += 1) {
      const rightExpected = heldOutFixture[rightIndex]
      const right = coverageById.get(rightExpected.id)
      if (!right) continue
      const merged = sharesTheme(left.themeIds, right.themeIds)
      const expectedMerged = Boolean(leftExpected.group && leftExpected.group === rightExpected.group)
      if (merged) {
        mergedPairs += 1
        if (leftExpected.topic === rightExpected.topic) coherentMergedPairs += 1
        else {
          falseMergePairs += 1
          failures.push(`False merge joins ${leftExpected.id} (${leftExpected.topic}) with ${rightExpected.id} (${rightExpected.topic})`)
        }
      } else if (expectedMerged) {
        missedMergePairs += 1
        failures.push(`Missed merge separates ${leftExpected.id} and ${rightExpected.id} from ${leftExpected.group}`)
      }
    }
  }

  return {
    total: heldOutFixture.length,
    covered: coverageById.size,
    exactQuotes,
    categoryCorrect,
    topicCorrect,
    falseMergePairs,
    missedMergePairs,
    topicCoherence: mergedPairs === 0 ? 1 : coherentMergedPairs / mergedPairs,
    failures,
  }
}

export function assertHeldOutQuality(result: HeldOutQualityResult) {
  if (result.failures.length) throw new Error(result.failures.join('; '))
}

export function assertHeldOutReplayCategoryRepeatability(replays: HeldOutCoverageItem[][]) {
  const categoryCorrectPerReplay = replays.map((coverage, index) => {
    const result = evaluateHeldOutCoverage(coverage)
    if (result.covered !== result.total || result.categoryCorrect !== result.total) {
      throw new Error(`Replay ${index + 1} category accuracy was ${result.categoryCorrect}/${result.total}; every exact replay must pass independently.`)
    }
    return result.categoryCorrect
  })
  return { replays: replays.length, categoryCorrectPerReplay }
}
