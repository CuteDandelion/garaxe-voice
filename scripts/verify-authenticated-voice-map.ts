import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { detectMapping, parseCsv } from '../src/lib/csv'
import { balancedCategoryDemoRunIds, controlledFixture, validateBalancedCategoryCoverage, validateControlledCoverage } from './voice-map-controlled-oracle'
import { assertHeldOutQuality, evaluateHeldOutCoverage, heldOutFixture } from './voice-map-held-out-oracle'
import { blinded100Input } from './voice-map-blinded-100-input'
import { blinded100PairRubric } from './voice-map-blinded-100-rubric'
import { independentHoldoutInput } from './voice-map-independent-10-input'
import { evaluateIndependentHoldout } from './voice-map-independent-10-rubric'
import { incrementalFeedbackBatches } from './voice-map-incremental-20-input'
import { capturePairExchange, replayObservedPairErrors, type CapturedPairBatch } from './voice-map-pair-repeatability'

process.env.GARAXE_DB_DIR = 'memory://'
process.env.GARAXE_ADMIN_BOOTSTRAP_ENABLED = 'true'
const pairRepeatability = process.env.VOICE_MAP_PAIR_REPEATABILITY === '1'
const inheritedFetch = globalThis.fetch.bind(globalThis)
const pairCaptures: CapturedPairBatch[] = []
if (pairRepeatability) globalThis.fetch = async (input, init) => {
  const response = await inheritedFetch(input, init)
  if (response.ok && typeof init?.body === 'string') {
    try {
      const request = JSON.parse(init.body)
      if (request.messages?.[0]?.content?.startsWith('You adjudicate explicitly ambiguous customer-feedback pairs.')) {
        const payload = await response.clone().json() as any
        const content = payload.choices?.[0]?.message?.content
        if (typeof content === 'string') {
          const capture = capturePairExchange(String(input), init.body, content)
          if (capture) pairCaptures.push(capture)
        }
      }
    } catch { /* evaluation capture must not affect the analysis request */ }
  }
  return response
}
const { handleRequest } = await import('../server/app')
const { createClusterInterpretationWorker, settleClusterInterpretationRuns } = await import('../server/clusterInterpretation')
const { closeDatabase, getDatabase } = await import('../server/db')
const server = createServer(handleRequest)
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Authenticated E2E API did not start.')
const baseUrl = `http://127.0.0.1:${address.port}`
const bootstrap = await fetch(`${baseUrl}/api/auth/bootstrap`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    email: 'local-e2e@example.invalid', displayName: 'Voice Map E2E', organizationName: 'Disposable Voice Map E2E',
  }),
})
const bootstrapPayload = await bootstrap.json()
if (!bootstrap.ok) throw new Error(`Admin-only fixture provisioning failed with HTTP ${bootstrap.status}.`)
const authToken = bootstrapPayload.data.token as string
const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' }
const database = await getDatabase()
const worker = await createClusterInterpretationWorker(database)
if (!worker) throw new Error('Authenticated E2E worker did not start with the inherited server-side contract.')

const cases = [
  {
    name: 'public-vscode-navigation',
    expected: /activity|icon|discover|search|density|setting|navigation|interface|onboard|clarity|usability/i,
    rows: [
      ['Activity bar icons are difficult to understand when someone is not familiar with them.', 'https://github.com/microsoft/vscode/issues/115641'],
      ['The command palette is difficult for new users to discover.', 'https://github.com/microsoft/vscode/issues/115641'],
      ['The integrated terminal is difficult for new users to discover.', 'https://github.com/microsoft/vscode/issues/115641'],
      ['Users want control over the overall interface density.', 'https://github.com/microsoft/vscode/issues/115641'],
      ['Labels on the activity bar would make navigation friendlier for new users.', 'https://github.com/microsoft/vscode/issues/115641'],
      ['Moving settings and accounts can help separate views from application menus.', 'https://github.com/microsoft/vscode/issues/115641'],
    ],
  },
  {
    name: 'public-vscode-state-and-recovery',
    expected: /extension|release|config|python|module|sign|notification|recover|access|state|setup|preference|error/i,
    rows: [
      ['The distinction between pre-release and stable-release extensions is confusing during daily use.', 'https://github.com/microsoft/vscode/issues/148117'],
      ['A pre-release badge can be mistaken for the installed pre-release state.', 'https://github.com/microsoft/vscode/issues/148117'],
      ['The default MCP configuration is confusing because it does not work out of the box.', 'https://github.com/microsoft/vscode/issues/244637'],
      ['The generated configuration reports that Python cannot find the time-server module.', 'https://github.com/microsoft/vscode/issues/244637'],
      ['After an update, a user can encounter problems signing in to the coding assistant.', 'https://github.com/microsoft/vscode/issues/242819'],
      ['A dismissed notification needs a discoverable way to reset the do-not-show preference.', 'https://github.com/microsoft/vscode/issues/24815'],
    ],
  },
] as const

let selectedCases: Array<{ name: string; expected: RegExp; rows: ReadonlyArray<readonly [string, string]> }> = [...cases]
if (process.env.VOICE_MAP_AUTH_FIXTURE) {
  const controlled = parseCsv(await readFile(process.env.VOICE_MAP_AUTH_FIXTURE, 'utf8'))
  selectedCases = [{
    name: 'controlled-public-30',
    expected: /export|setup|migrat|save|bill|mobile|password|contract|support|dashboard|price|color|evidence|privacy|refund/i,
    rows: controlled.rows.map((row) => [row.review_text, row.source_url] as const),
  }]
} else if (process.env.VOICE_MAP_E2E_MATRIX === 'held-out') {
  selectedCases = [{
    name: 'held-out-public-20',
    expected: /context|conversation|compile|upload|remote|workspace|command|shell|navigation|issue|field|environment|speech|compact|plan|executable|phone/i,
    rows: heldOutFixture.map((item) => [item.text, item.sourceUrl] as const),
  }]
} else if (process.env.VOICE_MAP_E2E_MATRIX === 'balanced-categories') {
  const controlledById = new Map(controlledFixture.map((item) => [item.id, item]))
  selectedCases = [{
    name: 'balanced-four-categories',
    expected: /invoice|tax|setup|onboard|migrat|switch|save|anxious|nervous/i,
    rows: balancedCategoryDemoRunIds.map((id) => [controlledById.get(id)!.text, `https://example.invalid/${id}`] as const),
  }]
} else if (process.env.VOICE_MAP_E2E_MATRIX === 'blinded-100') {
  selectedCases = [{
    name: 'blinded-public-style-100',
    expected: /./,
    rows: blinded100Input.map((item) => [item.text, item.sourceUrl] as const),
  }]
} else if (process.env.VOICE_MAP_E2E_MATRIX === 'independent-realistic') {
  selectedCases = [{
    name: 'independent-realistic-10',
    expected: /allergen|substitut|dock|bike|landlord|renter|ticket|museum|language/i,
    rows: independentHoldoutInput.map((item) => [item.text, item.sourceUrl] as const),
  }]
} else if (process.env.VOICE_MAP_E2E_MATRIX === 'incremental') {
  selectedCases = incrementalFeedbackBatches.map((batch) => ({
    name: batch.fileName,
    expected: /library|market|locker|collection|garden|veterinary|campsite|charger|pool|scale|receipt|watering/i,
    rows: batch.comments.map((item) => [item.text, item.sourceUrl] as const),
  }))
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const payload = response.headers.get('content-type')?.includes('json') ? await response.json() : null
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${payload?.error?.code || 'unknown'}`)
  return { response, payload }
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`
const incremental = process.env.VOICE_MAP_E2E_MATRIX === 'incremental'
let incrementalProject: any = null
const incrementalRows: Array<readonly [string, string]> = []
let firstIncremental: { runId: string; reportId: string; coverageTexts: string[]; reportSnapshot: string; curationName: string } | null = null

try {
  for (const [sampleIndex, sample] of selectedCases.entries()) {
    const project = incrementalProject || (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: sample.name, primaryDecision: 'product experience' }) })).payload.data
    if (incremental) incrementalProject = project
    const batch = incremental ? incrementalFeedbackBatches[sampleIndex] : null
    if (incremental) incrementalRows.push(...sample.rows)
    const expectedRows = incremental ? incrementalRows : sample.rows
    const rawCsv = ['review_id,source,entity,review_text,review_date,language,source_url', ...sample.rows.map((row, index) =>
      [incremental ? `${sampleIndex + 1}-${index + 1}` : String(index + 1), batch?.source || 'github_public', batch?.comments[index]?.entity || 'VS Code', row[0], batch?.comments[index]?.date || '2026-08-10', 'en', row[1]].map(csvCell).join(','),
    )].join('\n')
    const parsed = parseCsv(rawCsv)
    const imported = (await api('/api/imports', { method: 'POST', body: JSON.stringify({
      projectId: project.id, fileName: `${sample.name}.csv`, rawCsv, mapping: detectMapping(parsed.headers),
    }) })).payload.data
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const job = (await api(`/api/imports/${imported.id}`)).payload.data
      if (job.status === 'completed') break
      if (job.status === 'failed') throw new Error(`${sample.name} import failed.`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const run = (await api('/api/analysis-runs', { method: 'POST', body: JSON.stringify({
      projectId: project.id, configuration: { objective: 'full_voice_map', writtenOnly: true, minTextLength: 20 },
    }) })).payload.data
    let completed: any = null
    const analysisTimeoutSeconds = expectedRows.length > 10 ? 600 : 300
    for (let attempt = 0; attempt < analysisTimeoutSeconds; attempt += 1) {
      await worker.runOnce()
      await settleClusterInterpretationRuns(database)
      const current = (await api(`/api/analysis-runs/${run.id}`)).payload.data
      if (current.status === 'completed') { completed = current; break }
      if (current.status === 'failed') throw new Error(`${sample.name} analysis failed: ${current.errorMessage || 'unknown'}`)
      if (attempt > 0 && attempt % 30 === 0) console.log(`PROGRESS ${sample.name}: ${attempt}/${analysisTimeoutSeconds} seconds, stage=${current.stage}.`)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    if (!completed || completed.qualityReport?.clusterInterpretation?.state !== 'completed') throw new Error(`${sample.name} did not complete full interpretation.`)
    const coverage = (await api(`/api/analysis-runs/${run.id}/coverage`)).payload.data as Array<any>
    if (coverage.length !== expectedRows.length || coverage.some((item) => !item.disposition || !item.reason)) throw new Error(`${sample.name} silently dropped feedback.`)
    const expectedTexts = expectedRows.map(([text]) => text.trim()).sort()
    const actualTexts = coverage.map((item) => String(item.originalText).trim()).sort()
    if (JSON.stringify(actualTexts) !== JSON.stringify(expectedTexts)) throw new Error(`${sample.name} did not account for every submitted comment exactly once.`)
    if (coverage.some((item) => item.signals.some((signal: any) => !item.originalText.includes(signal.quote)))) throw new Error(`${sample.name} returned a non-exact signal quote.`)
    const actionableCategories = new Set(['pain', 'desired_outcome', 'objection', 'emotion', 'other'])
    if (coverage.filter((item) => ['recurring', 'emerging'].includes(item.disposition)).some((item) =>
      !item.signals.some((signal: any) => signal.interpretedBy === 'analysis_engine'
        && item.originalText.includes(signal.quote)
        && actionableCategories.has(signal.category)))) {
      throw new Error(`${sample.name} left retained feedback without an exact engine category.`)
    }
    const emerging = coverage.filter((item) => item.disposition === 'emerging')
    const recurring = coverage.filter((item) => item.disposition === 'recurring')
    if (coverage.some((item) => !['recurring', 'emerging', 'user_curated'].includes(item.disposition))) throw new Error(`${sample.name} left valid feedback outside recurring or emerging signals.`)
    if (emerging.some((item) => !item.signals.length || item.signals.some((signal: any) => signal.interpretedBy !== 'analysis_engine'))) {
      throw new Error(`${sample.name} left an outlier without bounded engine interpretation.`)
    }
    const voiceMap = (await api(`/api/analysis-runs/${run.id}/voice-map`)).payload.data
    const evidence = voiceMap.themes.flatMap((theme: any) => theme.evidence)
    if (!evidence.length || evidence.some((item: any) => !item.originalText.includes(item.quote))) throw new Error(`${sample.name} Voice Map evidence is not exact.`)
    const labels = [...voiceMap.themes.map((theme: any) => theme.validation?.interpretationCandidate?.label).filter(Boolean), ...emerging.flatMap((item) => item.signals.map((signal: any) => signal.label))]
    if (!labels.some((label) => sample.expected.test(label))) throw new Error(`${sample.name} returned no label grounded in the expected source topics: ${JSON.stringify(labels)}`)
    if (process.env.VOICE_MAP_AUTH_FIXTURE || ['held-out', 'balanced-categories', 'blinded-100', 'independent-realistic'].includes(process.env.VOICE_MAP_E2E_MATRIX || '')) {
      const interpretations = await database.query<{ originalText: string; topic: string }>(
        `SELECT COALESCE(r.body_original, '') AS "originalText",
          COALESCE(rs.attributes->'canonicalOutcome', rs.attributes->'emergingInterpretation')->>'topic' AS topic
         FROM review_signals rs JOIN reviews r ON r.id = rs.review_id
         WHERE rs.analysis_run_id = $1
           AND (rs.attributes ? 'canonicalOutcome' OR rs.attributes ? 'emergingInterpretation')`, [run.id],
      )
      const topics = new Map(interpretations.rows.map((item) => [item.originalText, item.topic]))
      for (const item of coverage) for (const signal of item.signals) signal.topic = topics.get(item.originalText)
      if (process.env.VOICE_MAP_E2E_DIAGNOSTICS === '1') console.log(JSON.stringify(coverage.map((item) => ({
        id: heldOutFixture.find((fixture) => fixture.text === item.originalText)?.id,
        disposition: item.disposition, themeIds: item.themeIds,
        signals: item.signals.filter((signal: any) => signal.interpretedBy === 'analysis_engine')
          .map((signal: any) => ({ label: signal.label, topic: signal.topic, category: signal.category, categories: signal.categories })),
      })), null, 2))
      if (process.env.VOICE_MAP_AUTH_FIXTURE) {
        try {
          const result = validateControlledCoverage(coverage)
          console.log(`CONTROLLED_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
        } catch (error) {
          console.log(`CONTROLLED_QA_MONITOR ${JSON.stringify({ pass: false, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
        }
      } else if (process.env.VOICE_MAP_E2E_MATRIX === 'balanced-categories') {
        try {
          const result = validateBalancedCategoryCoverage(coverage)
          console.log(`CATEGORY_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
        } catch (error) {
          console.log(`CATEGORY_QA_MONITOR ${JSON.stringify({ pass: false, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
        }
      } else if (process.env.VOICE_MAP_E2E_MATRIX === 'held-out') {
        const result = evaluateHeldOutCoverage(coverage)
        try {
          assertHeldOutQuality(result)
          console.log(`HELD_OUT_QA_MONITOR ${JSON.stringify({ pass: true, ...result })}`)
        } catch (error) {
          console.log(`HELD_OUT_QA_MONITOR ${JSON.stringify({ pass: false, ...result, message: error instanceof Error ? error.message : 'unknown mismatch' })}`)
        }
      } else if (process.env.VOICE_MAP_E2E_MATRIX === 'independent-realistic') {
        console.log(`INDEPENDENT_HOLDOUT_RESULT ${JSON.stringify(evaluateIndependentHoldout(coverage))}`)
      } else {
        const { evaluateBlinded100 } = await import('./voice-map-blinded-100-evaluator')
        const { buildBlinded100Diagnostic } = await import('./voice-map-blinded-100-diagnostics')
        const diagnostic = await buildBlinded100Diagnostic(database, run.id, coverage)
        if (!pairRepeatability) await writeFile('/private/tmp/voice-map-blinded-100-diagnostic.json', JSON.stringify(diagnostic, null, 2), { mode: 0o600 })
        const evaluation = evaluateBlinded100(coverage)
        console.log(`BLINDED_100_RESULT ${JSON.stringify(evaluation)}`)
        console.log(`BLINDED_100_DIAGNOSTIC ${JSON.stringify({ totalMisses: diagnostic.totalMisses, counts: diagnostic.counts, byCategory: diagnostic.byCategory, byTopic: diagnostic.byTopic })}`)
        if (pairRepeatability) {
          const apiKey = process.env.OPENCODE_GO_API_KEY
          if (!apiKey) throw new Error('Pair repeatability requires the inherited server-side credential.')
          const runtimeToBlind = new Map(coverage.map((item) => [
            item.reviewId, blinded100Input.find((input) => input.text === item.originalText)!.id,
          ]))
          const expectedByPair = new Map(blinded100PairRubric.map((pair) => [pair.pairId, pair.expectedMerge]))
          const diagnostics = await replayObservedPairErrors({
            captures: pairCaptures, runtimeToBlind, expectedByPair,
            request: async (url, body) => {
              const started = performance.now()
              const response = await inheritedFetch(url, {
                method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body,
                signal: AbortSignal.timeout(Number(process.env.OPENCODE_GO_TIMEOUT_MS) || 180_000),
              })
              if (!response.ok) throw new Error(`PAIR_REPLAY_HTTP_${response.status}`)
              const payload = await response.json() as any
              const content = payload.choices?.[0]?.message?.content
              if (typeof content !== 'string') throw new Error('PAIR_REPLAY_INVALID_RESPONSE')
              return { content, latencyMs: Math.round(performance.now() - started) }
            },
          })
          pairCaptures.length = 0
          console.log(`BLINDED_100_REPEATABILITY ${JSON.stringify(diagnostics)}`)
        }
        continue
      }
    }

    const curation = (await api(`/api/analysis-runs/${run.id}/curation-sessions`, { method: 'POST', body: '{}' })).payload.data.session
    let projection = (await api(`/api/analysis-runs/${run.id}/curation`)).payload.data
    const editable = coverage.find((item) => item.disposition === 'emerging') || coverage.find((item) => item.disposition === 'recurring')
    if (!editable) throw new Error(`${sample.name} did not expose a categorized comment for Curation proof.`)
    const curationName = incremental ? `Incremental correction ${sampleIndex + 1}` : editable.disposition === 'emerging' ? 'Renamed retained signal' : 'Renamed recurring bucket'
    if (editable.disposition === 'emerging') {
      projection = (await api(`/api/curation-sessions/${curation.id}/actions`, { method: 'POST', body: JSON.stringify({ actionType: 'create_custom_theme', payload: { name: 'Reviewed emerging signal', summary: 'User-curated from exact retained feedback.', reviewIds: [editable.reviewId] } }) })).payload.data.projection
      const custom = projection.effectiveThemes.find((theme: any) => theme.origin === 'user_curated' && theme.evidence.some((item: any) => item.reviewId === editable.reviewId))
      if (!custom) throw new Error(`${sample.name} could not assign the emerging comment in Curation.`)
      projection = (await api(`/api/curation-sessions/${curation.id}/actions`, { method: 'POST', body: JSON.stringify({ actionType: 'edit_theme', payload: { themeId: custom.id, name: curationName, summary: 'Authenticated revision preserves the exact source assignment.' } }) })).payload.data.projection
      if (!projection.effectiveThemes.some((theme: any) => theme.id === custom.id && theme.name === curationName)) throw new Error(`${sample.name} did not persist the Curation rename.`)
    } else {
      const themeId = editable.themeIds[0]
      projection = (await api(`/api/curation-sessions/${curation.id}/actions`, { method: 'POST', body: JSON.stringify({ actionType: 'edit_theme', payload: { themeId, name: curationName, summary: 'Authenticated revision preserves the recurring source assignment.' } }) })).payload.data.projection
      if (!projection.effectiveThemes.some((theme: any) => theme.id === themeId && theme.name === curationName)) throw new Error(`${sample.name} did not persist the recurring-bucket rename.`)
    }
    for (const theme of projection.machineThemes) await api(`/api/curation-sessions/${curation.id}/actions`, {
      method: 'POST', body: JSON.stringify({ actionType: 'approve_theme', payload: { themeId: theme.id } }),
    })
    await api(`/api/curation-sessions/${curation.id}/actions`, { method: 'POST', body: JSON.stringify({ actionType: 'mark_ready', payload: {} }) })
    const report = (await api('/api/reports', { method: 'POST', body: JSON.stringify({ projectId: project.id, analysisRunId: run.id, title: `${sample.name} Voice Map` }) })).payload.data
    const pdf = await fetch(`${baseUrl}/api/reports/${report.id}/pdf`, { headers: { authorization: `Bearer ${authToken}` } })
    const bytes = Buffer.from(await pdf.arrayBuffer())
    if (!pdf.ok || !pdf.headers.get('cache-control')?.includes('no-store') || bytes.subarray(0, 4).toString() !== '%PDF') throw new Error(`${sample.name} report PDF failed.`)
    if (incremental && sampleIndex === 0) firstIncremental = { runId: run.id, reportId: report.id, coverageTexts: actualTexts, reportSnapshot: JSON.stringify(report.snapshot), curationName }
    if (incremental && sampleIndex === 1) {
      if (!firstIncremental) throw new Error('Incremental authenticated baseline was not retained.')
      const sourceState = await database.query<{ imports: number; providers: number; reviews: number }>(
        `SELECT (SELECT COUNT(*)::int FROM import_jobs WHERE project_id = $1 AND status = 'completed') AS imports,
          COUNT(DISTINCT provider)::int AS providers, COUNT(*)::int AS reviews FROM reviews WHERE project_id = $1`, [project.id],
      )
      if (sourceState.rows[0]?.imports !== 2 || sourceState.rows[0]?.providers !== 2 || sourceState.rows[0]?.reviews !== 20) throw new Error(`Incremental source inventory was not 2 imports / 2 providers / 20 reviews: ${JSON.stringify(sourceState.rows[0])}`)
      const oldCoverage = (await api(`/api/analysis-runs/${firstIncremental.runId}/coverage`)).payload.data as Array<any>
      const oldTexts = oldCoverage.map((item) => String(item.originalText).trim()).sort()
      if (JSON.stringify(oldTexts) !== JSON.stringify(firstIncremental.coverageTexts)) throw new Error('The second import rewrote the first immutable analysis run.')
      const oldProjection = (await api(`/api/analysis-runs/${firstIncremental.runId}/curation`)).payload.data
      if (!oldProjection.effectiveThemes.some((theme: any) => theme.name === firstIncremental!.curationName)
        || oldProjection.effectiveThemes.some((theme: any) => theme.name === curationName)) throw new Error('Curation crossed incremental analysis runs.')
      const oldReport = (await api(`/api/reports/${firstIncremental.reportId}`)).payload.data
      if (JSON.stringify(oldReport.snapshot) !== firstIncremental.reportSnapshot) throw new Error('The second run changed the first immutable report snapshot.')
      const oldPdf = await fetch(`${baseUrl}/api/reports/${firstIncremental.reportId}/pdf`, { headers: { authorization: `Bearer ${authToken}` } })
      const oldPdfBytes = Buffer.from(await oldPdf.arrayBuffer())
      if (!oldPdf.ok || !oldPdf.headers.get('cache-control')?.includes('no-store') || oldPdfBytes.subarray(0, 4).toString() !== '%PDF') throw new Error('The first immutable report no longer downloads as a valid no-store PDF.')
      console.log('PASS incremental authenticated: run 1 retained 10 comments; run 2 combined 20 current project comments from 2 sources; old run, Curation, and report remained immutable.')
    }
    console.log(`PASS ${sample.name}: ${coverage.length}/${expectedRows.length} accounted, ${recurring.length} recurring, ${emerging.length} emerging, exact evidence, report PDF.`)
  }
} finally {
  pairCaptures.length = 0
  globalThis.fetch = inheritedFetch
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await closeDatabase()
}
