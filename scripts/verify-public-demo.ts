import { balancedCategoryDemoRunIds, controlledDemoRunIds, controlledFixture, validateBalancedCategoryCoverage, validateControlledCoverage, validatePraiseRubricCoverage, type ControlledCoverageItem } from './voice-map-controlled-oracle'
import { assertHeldOutQuality, evaluateHeldOutCoverage, heldOutDemoRunIds, heldOutFixture, type HeldOutCoverageItem } from './voice-map-held-out-oracle'
import { independentHoldoutInput } from './voice-map-independent-10-input'
import { evaluateIndependentHoldout } from './voice-map-independent-10-rubric'
import { incrementalFeedbackBatches } from './voice-map-incremental-20-input'

const baseUrl = (process.env.VOICE_MAP_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
const representativeCases = [
  {
    name: 'controlled-emerging',
    expected: /progress|status|update|error|recover/i,
    comments: [
      'I loved the proactive progress update because the next step was clear and easy to trust.',
      'The clear milestone update was excellent and made the whole process feel calm.',
      'I appreciated seeing exactly what changed because the progress update removed uncertainty.',
      'The friendly progress message made it easy to understand what would happen next.',
      'Clear status updates were wonderful and helped me trust every step of the service.',
      'The weekly milestone note showed what was finished and what would happen next.',
      'A concise status message prevented me from chasing the team for an update.',
      'Seeing the next checkpoint made the remaining wait feel predictable.',
      'The progress timeline explained the handoff clearly and reduced uncertainty.',
      'I hate that a dismissed error disappears before I can understand how to recover from the failure.',
    ],
  },
  {
    name: 'public-vscode-navigation',
    expected: /activity|icon|discover|search|density|setting|navigation|interface|onboard|clarity|usability/i,
    comments: [
      'Activity bar icons are difficult to understand when someone is not familiar with them.',
      'The command palette is difficult for new users to discover.',
      'The integrated terminal is difficult for new users to discover.',
      'Users want control over the overall interface density.',
      'Labels on the activity bar would make navigation friendlier for new users.',
      'Moving settings and accounts can help separate views from application menus.',
      'An omni search could make commands and files easier to find from one visible place.',
      'A terminal toggle in the status bar would make the terminal easier to discover.',
      'Consistent padding would make the workbench easier to scan across views.',
      'Putting account controls in the title area may consume useful window-dragging space.',
    ],
  },
  {
    name: 'public-vscode-state-and-recovery',
    expected: /extension|release|config|python|module|sign|notification|recover|access|state|setup|preference|error/i,
    comments: [
      'The distinction between pre-release and stable-release extensions is confusing during daily use.',
      'A pre-release badge can be mistaken for the installed pre-release state.',
      'The default MCP configuration is confusing because it does not work out of the box.',
      'The generated configuration reports that Python cannot find the time-server module.',
      'After an update, a user can encounter problems signing in to the coding assistant.',
      'A dismissed notification needs a discoverable way to reset the do-not-show preference.',
      'Stable and preview extension states need clearer visual language for the active version.',
      'Installing the suggested package still leaves the generated configuration broken.',
      'The account flow times out without a clear recovery path after the update.',
      'Hidden notification preferences should be visible so users can restore them.',
    ],
  },
] as const

const controlledById = new Map(controlledFixture.map((item) => [item.id, item]))
const controlledCases = controlledDemoRunIds.map((ids, index) => ({
  name: `controlled-matrix-${index + 1}`,
  expected: /export|setup|migrat|save|bill|mobile|password|contract|support|dashboard|price|color|evidence|privacy|refund/i,
  comments: ids.map((id) => controlledById.get(id)!.text),
}))
const balancedCategoryCases = [{
  name: 'balanced-four-categories',
  expected: /invoice|tax|setup|onboard|migrat|switch|save|anxious|nervous/i,
  comments: balancedCategoryDemoRunIds.map((id) => controlledById.get(id)!.text),
}]
const heldOutById = new Map(heldOutFixture.map((item) => [item.id, item]))
const heldOutCases = heldOutDemoRunIds.map((ids, index) => ({
  name: `held-out-public-${index + 1}`,
  expected: /context|conversation|compile|upload|remote|workspace|command|shell|navigation|issue|field|environment|speech|compact|plan|executable|phone/i,
  comments: ids.map((id) => heldOutById.get(id)!.text),
}))
const independentCases = [{
  name: 'independent-realistic-10',
  expected: /allergen|substitut|dock|bike|landlord|renter|ticket|museum|language/i,
  comments: independentHoldoutInput.map((item) => item.text),
}]
const incrementalCases = incrementalFeedbackBatches.map((batch) => ({
  name: batch.fileName,
  expected: /library|market|locker|collection|garden|veterinary|campsite|charger|pool|scale|receipt|watering/i,
  comments: batch.comments.map((item) => item.text),
}))
const cases = process.env.VOICE_MAP_E2E_MATRIX === 'controlled'
  ? controlledCases
  : process.env.VOICE_MAP_E2E_MATRIX === 'balanced-categories' ? balancedCategoryCases
  : process.env.VOICE_MAP_E2E_MATRIX === 'held-out' ? heldOutCases
  : process.env.VOICE_MAP_E2E_MATRIX === 'independent-realistic' ? independentCases
  : process.env.VOICE_MAP_E2E_MATRIX === 'incremental' ? incrementalCases : representativeCases
const selectedCases = process.env.VOICE_MAP_E2E_CASE ? cases.filter((sample) => sample.name === process.env.VOICE_MAP_E2E_CASE) : cases
if (!selectedCases.length) throw new Error('No matching public demo E2E case.')

const controlledCoverage: ControlledCoverageItem[] = []
const heldOutCoverage: HeldOutCoverageItem[] = []
const independentCoverage: any[] = []
const incrementalRuns: Array<{ token: string; coverage: any[]; name: string }> = []
for (const sample of selectedCases) {
  const start = await fetch(`${baseUrl}/api/demo/analysis-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: sample.comments.join('\n') }),
  })
  const created = await start.json() as { data?: { token: string }; error?: { code?: string; message?: string } }
  if (start.status === 503) throw new Error(`BLOCKED: ${created.error?.code || 'DEMO_ANALYSIS_UNAVAILABLE'} — the server-side analysis-engine contract is unavailable.`)
  if (!start.ok || !created.data) throw new Error(`${sample.name} demo start failed with HTTP ${start.status}: ${created.error?.message || 'unknown error'}`)

  let completed: { status: string; engine?: string; themes?: Array<{ name?: string; evidence?: Array<{ originalText: string; quote: string }> }>; coverage?: Array<ControlledCoverageItem & { disposition: string; reason: string; originalText: string; themeIds: string[]; signals: Array<{ label: string; topic?: string | null; quote: string; confidence: number; interpretedBy: string; signalType?: string; signalTypes?: string[]; sentiment?: string; category?: string; categories?: string[] }> }>; pdfUrl?: string; message?: string } | null = null
  for (let attempt = 0; attempt < 270; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}`)
    const payload = await response.json() as { data?: typeof completed }
    if (!response.ok || !payload.data) throw new Error(`${sample.name} demo status failed with HTTP ${response.status}.`)
    if (payload.data.status === 'failed') throw new Error(payload.data.message || `${sample.name} live analysis-engine demo run failed.`)
    if (payload.data.status === 'completed') { completed = payload.data; break }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const hasExactCategorizedEvidence = completed?.coverage?.some((item) => item.signals.some((signal) => item.originalText.includes(signal.quote)))
    || completed?.themes?.some((theme) => (theme.evidence?.length || 0) > 0)
  if (!completed || completed.engine !== 'llm-interpreted-theme-engine-v1' || !hasExactCategorizedEvidence || !completed.pdfUrl) {
    throw new Error(`${sample.name} did not produce a same-engine evidence-backed result within 180 seconds.`)
  }
  if (completed.coverage?.length !== sample.comments.length || completed.coverage.some((item) => !item.disposition || !item.reason)) {
    throw new Error(`${sample.name} silently dropped feedback.`)
  }
  const expectedTexts = [...sample.comments].map((text) => text.trim()).sort()
  const actualTexts = completed.coverage.map((item) => item.originalText.trim()).sort()
  if (JSON.stringify(actualTexts) !== JSON.stringify(expectedTexts)) throw new Error(`${sample.name} did not account for every submitted comment exactly once.`)
  if (completed.coverage.some((item) => item.signals.some((signal) => !item.originalText.includes(signal.quote)))) {
    throw new Error(`${sample.name} returned a non-exact signal quote.`)
  }
  const actionableCategories = new Set(['pain', 'desired_outcome', 'objection', 'emotion', 'other'])
  if (completed.coverage.filter((item) => ['recurring', 'emerging'].includes(item.disposition)).some((item) =>
    !item.signals.some((signal) => signal.interpretedBy === 'analysis_engine'
      && item.originalText.includes(signal.quote)
      && Boolean(signal.category && actionableCategories.has(signal.category))))) {
    throw new Error(`${sample.name} left retained feedback without an exact engine category.`)
  }
  const emerging = completed.coverage.filter((item) => item.disposition === 'emerging')
  const confirmedThemeIds = new Set(completed.coverage.filter((item) => item.disposition === 'recurring').flatMap((item) => item.themeIds))
  if (completed.coverage.some((item) => !['recurring', 'emerging', 'user_curated'].includes(item.disposition))) throw new Error(`${sample.name} left valid feedback outside recurring or emerging signals.`)
  if (emerging.some((item) => !item.signals.some((signal) =>
    signal.interpretedBy === 'analysis_engine' && item.originalText.includes(signal.quote)))) {
    throw new Error(`${sample.name} left an outlier without bounded engine interpretation.`)
  }
  const evidence = completed.themes.flatMap((theme) => theme.evidence || [])
  if (evidence.some((item) => !item.originalText.includes(item.quote))) throw new Error(`${sample.name} Voice Map evidence is not exact.`)
  const labels = [...completed.themes.map((theme) => theme.name || ''), ...emerging.flatMap((item) => item.signals.map((signal) => signal.label))]
  if (!labels.some((label) => sample.expected.test(label))) throw new Error(`${sample.name} returned no label grounded in the expected source topics.`)
  if (/opencode(?:_go)?|qwen3\.7/i.test(JSON.stringify(completed))) throw new Error(`${sample.name} exposed provider branding.`)
  if (['controlled', 'balanced-categories'].includes(process.env.VOICE_MAP_E2E_MATRIX || '')) controlledCoverage.push(...completed.coverage)
  if (process.env.VOICE_MAP_E2E_MATRIX === 'held-out') heldOutCoverage.push(...completed.coverage)
  if (process.env.VOICE_MAP_E2E_MATRIX === 'independent-realistic') independentCoverage.push(...completed.coverage)
  if (process.env.VOICE_MAP_E2E_MATRIX === 'incremental') {
    const curationResponse = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`)
    const curationPayload = await curationResponse.json() as any
    const theme = curationPayload.data?.effectiveThemes?.[0]
    if (!curationResponse.ok || !theme) throw new Error(`${sample.name} did not expose temporary Curation.`)
    const editedResponse = await fetch(`${baseUrl}/api/demo/analysis-runs/${created.data.token}/curation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        actionType: 'edit_theme', payload: { themeId: theme.id, name: `Temporary correction ${incrementalRuns.length + 1}`, summary: 'Temporary source-scoped correction.' },
      }),
    })
    const editedPayload = await editedResponse.json() as any
    if (!editedResponse.ok || !editedPayload.data?.projection?.effectiveThemes?.some((item: any) => item.id === theme.id && item.name === `Temporary correction ${incrementalRuns.length + 1}`)) {
      throw new Error(`${sample.name} did not retain its temporary Curation correction.`)
    }
    incrementalRuns.push({ token: created.data.token, coverage: completed.coverage, name: sample.name })
  }
  if (sample.name === 'controlled-emerging') {
    try {
      console.log('PRAISE_QA_MONITOR', JSON.stringify({ pass: true, ...validatePraiseRubricCoverage(completed.coverage) }))
    } catch (error) {
      console.log('PRAISE_QA_MONITOR', JSON.stringify({ pass: false, message: error instanceof Error ? error.message : 'unknown mismatch' }))
    }
  }
  if (process.env.VOICE_MAP_E2E_DIAGNOSTICS === '1') {
    console.log(JSON.stringify(completed.coverage.map((item) => ({
      id: controlledFixture.find((fixture) => fixture.text === item.originalText)?.id,
      disposition: item.disposition,
      themeIds: item.themeIds,
      engineSignals: item.signals.filter((signal) => signal.interpretedBy === 'analysis_engine')
        .map((signal) => ({ label: signal.label, topic: signal.topic, category: signal.category, categories: signal.categories })),
    })), null, 2))
  }

  const pdfResponse = await fetch(`${baseUrl}${completed.pdfUrl}`)
  const pdf = Buffer.from(await pdfResponse.arrayBuffer())
  if (pdfResponse.headers.get('cache-control') !== 'private, no-store, max-age=0'
    || pdfResponse.headers.get('pragma') !== 'no-cache' || pdfResponse.headers.get('expires') !== '0'
    || pdf.subarray(0, 4).toString() !== '%PDF') throw new Error(`${sample.name} demo PDF or no-store headers are invalid.`)
  console.log(`PASS ${sample.name}: ${completed.coverage.length}/${sample.comments.length} accounted, ${confirmedThemeIds.size} recurring, ${emerging.length} emerging, exact evidence, no-store PDF.`)
}

if (process.env.VOICE_MAP_E2E_MATRIX === 'controlled' && selectedCases.length === controlledCases.length) {
  try {
    const result = validateControlledCoverage(controlledCoverage)
    console.log(`CONTROLLED_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
  } catch (error) {
    console.log(`CONTROLLED_QA_MONITOR ${JSON.stringify({ pass: false, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
  }
}

if (process.env.VOICE_MAP_E2E_MATRIX === 'balanced-categories') {
  try {
    const result = validateBalancedCategoryCoverage(controlledCoverage)
    console.log(`CATEGORY_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
  } catch (error) {
    console.log(`CATEGORY_QA_MONITOR ${JSON.stringify({ pass: false, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
  }
}

if (process.env.VOICE_MAP_E2E_MATRIX === 'held-out' && selectedCases.length === heldOutCases.length) {
  const result = evaluateHeldOutCoverage(heldOutCoverage)
  try {
    assertHeldOutQuality(result)
    console.log(`HELD_OUT_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
  } catch (error) {
    console.log(`HELD_OUT_QA_MONITOR ${JSON.stringify({ pass: false, ...result, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
  }
}

if (process.env.VOICE_MAP_E2E_MATRIX === 'independent-realistic') {
  const result = evaluateIndependentHoldout(independentCoverage)
  console.log(`INDEPENDENT_HOLDOUT_RESULT ${JSON.stringify(result)}`)
}

if (process.env.VOICE_MAP_E2E_MATRIX === 'incremental') {
  if (incrementalRuns.length !== 2 || incrementalRuns[0].token === incrementalRuns[1].token) throw new Error('Incremental Demo submissions did not create two isolated sessions.')
  const first = new Set(incrementalRuns[0].coverage.map((item) => item.originalText))
  const second = new Set(incrementalRuns[1].coverage.map((item) => item.originalText))
  if (first.size !== 10 || second.size !== 10 || [...first].some((text) => second.has(text))) throw new Error('Incremental Demo submissions accumulated, duplicated, or crossed feedback.')
  const firstCuration = await fetch(`${baseUrl}/api/demo/analysis-runs/${incrementalRuns[0].token}/curation`).then((response) => response.json()) as any
  if (!firstCuration.data?.effectiveThemes?.some((item: any) => item.name === 'Temporary correction 1')
    || firstCuration.data.effectiveThemes.some((item: any) => item.name === 'Temporary correction 2')) {
    throw new Error('Incremental Demo Curation crossed session boundaries.')
  }
  console.log('PASS incremental Demo: two separate 10-comment sessions, exact-once coverage, isolated temporary Curation, no accumulation.')
}

const protectedResponse = await fetch(`${baseUrl}/api/projects`)
if (protectedResponse.status !== 401) throw new Error('The public demo crossed the protected workspace boundary.')
console.log(`PASS isolation: protected workspace remained unauthorized after ${selectedCases.length} live demo runs.`)

const malformedResponse = await fetch(`${baseUrl}/api/demo/analysis-runs`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: '   ' }),
})
if (malformedResponse.status !== 400) throw new Error(`Malformed demo input returned HTTP ${malformedResponse.status} instead of an explicit input error.`)
console.log('PASS malformed boundary: unsupported empty input was rejected before analysis.')
