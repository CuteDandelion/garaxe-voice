import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDatabase } from '../db'
import { createAnalysisRun, processAnalysisRun } from '../analysisRuns'
import { createImportJob, processImportJob } from '../importProcessor'
import { detectMapping, parseCsv } from '../../src/lib/csv'
import {
  buildClusterInterpretationMessages,
  clusterInterpretationPolicyFromEnv,
  clusterInterpretationThemeBatches,
  CLUSTER_INTERPRETATION_PROMPT_VERSION,
  CLUSTER_INTERPRETATION_SCHEMA_VERSION,
  loadClusterWork,
  selectedInterpretationThemes,
  validateClusterInterpretations,
} from '../clusterInterpretation'
import { openCodeGoProviderFromEnv } from '../llmProvider'

const database = await getDatabase()
const fixtureIndex = process.argv.indexOf('--fixture')
const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : null
const numericOption = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
  return value
}
const evaluationBatchSize = numericOption('--batch-size', 4)
const themeLimit = numericOption('--limit', Number.MAX_SAFE_INTEGER)
const optionValueIndexes = new Set(['--fixture', '--batch-size', '--limit'].flatMap((name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? [index, index + 1] : []
}))
const requestedRunId = process.argv.find((argument, index) => index >= 2 && !optionValueIndexes.has(index) && !argument.startsWith('--'))

let fixtureRun: { id: string; createdAt: string } | null = null
if (fixturePath) {
  const organizationId = randomUUID()
  const projectId = randomUUID()
  await database.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Cluster benchmark')`, [organizationId])
  await database.query(`INSERT INTO projects (id, name, primary_decision) VALUES ($1, 'Game feedback benchmark', 'research')`, [projectId])
  await database.query(`INSERT INTO project_organizations (project_id, organization_id) VALUES ($1, $2)`, [projectId, organizationId])
  const rawCsv = await readFile(resolve(fixturePath), 'utf8')
  const parsed = parseCsv(rawCsv)
  const request = {
    projectId,
    fileName: fixturePath.split('/').pop() || 'benchmark.csv',
    rawCsv,
    mapping: detectMapping(parsed.headers),
    originalSource: { encoding: 'utf8' as const, content: rawCsv, mediaType: 'text/csv' },
  }
  const importJob = await createImportJob(database, request)
  await processImportJob(database, importJob.jobId, request, importJob.rows)
  const analysisRun = await createAnalysisRun(database, projectId, {
    objective: 'full_voice_map', entities: [], ratings: [], languages: [], writtenOnly: true, minTextLength: 3,
  })
  await processAnalysisRun(database, analysisRun.id)
  fixtureRun = { id: analysisRun.id, createdAt: new Date().toISOString() }
}

const runResult = fixtureRun ? { rows: [fixtureRun] } : requestedRunId
  ? await database.query<{ id: string; createdAt: string }>(
    `SELECT id, created_at AS "createdAt" FROM analysis_runs WHERE id = $1`, [requestedRunId],
  )
  : await database.query<{ id: string; createdAt: string }>(
    `SELECT ar.id, ar.created_at AS "createdAt" FROM analysis_runs ar
     WHERE EXISTS (SELECT 1 FROM themes t WHERE t.analysis_run_id = ar.id)
     ORDER BY ar.created_at DESC LIMIT 1`,
  )
const run = runResult.rows[0]
if (!run) throw new Error('No analysis run with persisted themes is available for evaluation.')

const policy = clusterInterpretationPolicyFromEnv()
const provider = openCodeGoProviderFromEnv()
if (!policy || !provider) throw new Error('The configured OpenCode Go evaluation provider is unavailable.')

const work = await loadClusterWork(database, run.id)
const selectedThemes = selectedInterpretationThemes(work).slice(0, themeLimit)
const batches = evaluationBatchSize === 4
  ? clusterInterpretationThemeBatches({ themes: selectedThemes })
  : Array.from({ length: Math.ceil(selectedThemes.length / evaluationBatchSize) }, (_, index) => ({
    themes: selectedThemes.slice(index * evaluationBatchSize, (index + 1) * evaluationBatchSize),
  }))
const batchResults: Array<Record<string, unknown>> = []
const candidateSummaries: Array<Record<string, unknown>> = []
const latencies: number[] = []
let completedBatches = 0
let acceptedCandidates = 0
let rejectedCandidates = 0
let inputTokens = 0
let outputTokens = 0
let totalTokens = 0
const rejectionReasons: Record<string, number> = {}

for (const [index, batch] of batches.entries()) {
  const started = Date.now()
  try {
    const completion = await provider.complete({
      model: policy.model,
      messages: buildClusterInterpretationMessages(batch),
      maxTokens: policy.maxOutputTokens,
      temperature: 0,
      json: true,
      enableThinking: false,
    })
    const latencyMs = Date.now() - started
    latencies.push(latencyMs)
    inputTokens += completion.usage.inputTokens || 0
    outputTokens += completion.usage.outputTokens || 0
    totalTokens += completion.usage.totalTokens || 0
    let parsed: unknown
    try { parsed = JSON.parse(completion.content) } catch { parsed = null }
    const validation = validateClusterInterpretations(batch, parsed)
    completedBatches += 1
    acceptedCandidates += validation.accepted.length
    rejectedCandidates += validation.rejected.length
    for (const rejection of validation.rejected) {
      rejectionReasons[rejection.reason] = (rejectionReasons[rejection.reason] || 0) + 1
    }
    candidateSummaries.push(...validation.accepted.map((candidate) => ({
      themeId: candidate.themeId,
      label: candidate.label,
      aspect: candidate.aspect,
      evaluation: candidate.evaluation,
      signalTypes: candidate.signalTypes,
      rootCause: candidate.rootCause,
      consequence: candidate.consequence,
      confidence: candidate.confidence,
      evidenceCount: candidate.evidence.length,
      hasRootCauseEvidence: candidate.rootCauseEvidence !== null,
      hasConsequenceEvidence: candidate.consequenceEvidence !== null,
    })))
    batchResults.push({
      batch: index + 1,
      expectedCandidates: batch.themes.length,
      acceptedCandidates: validation.accepted.length,
      rejectedCandidates: validation.rejected.length,
      rejectionReasons: validation.rejected.map((item) => item.reason),
      latencyMs,
      finishReason: completion.finishReason,
    })
    process.stdout.write(`batch ${index + 1}/${batches.length}: ${validation.accepted.length}/${batch.themes.length} accepted in ${latencyMs}ms (${completion.finishReason || 'unknown'})\n`)
  } catch (error) {
    const latencyMs = Date.now() - started
    latencies.push(latencyMs)
    batchResults.push({
      batch: index + 1,
      expectedCandidates: batch.themes.length,
      acceptedCandidates: 0,
      rejectedCandidates: batch.themes.length,
      latencyMs,
      error: error instanceof Error ? error.name : 'UnknownError',
    })
    process.stdout.write(`batch ${index + 1}/${batches.length}: failed in ${latencyMs}ms\n`)
  }
}

const sortedLatencies = [...latencies].sort((left, right) => left - right)
const percentile = (fraction: number) => sortedLatencies[Math.min(sortedLatencies.length - 1, Math.max(0, Math.ceil(sortedLatencies.length * fraction) - 1))] || 0
const expectedCandidates = batches.reduce((count, batch) => count + batch.themes.length, 0)
const report = {
  evaluation: 'production-cluster-schema-no-thinking-v1',
  analysisRunId: run.id,
  analysisRunCreatedAt: run.createdAt,
  evaluatedAt: new Date().toISOString(),
  model: policy.model,
  enableThinking: false,
  evaluationBatchSize,
  themeLimit: Math.min(themeLimit, work.themes.length),
  promptVersion: CLUSTER_INTERPRETATION_PROMPT_VERSION,
  schemaVersion: CLUSTER_INTERPRETATION_SCHEMA_VERSION,
  batches: { total: batches.length, completed: completedBatches },
  candidates: {
    expected: expectedCandidates,
    accepted: acceptedCandidates,
    rejected: rejectedCandidates,
    acceptanceRate: expectedCandidates > 0 ? acceptedCandidates / expectedCandidates : 0,
    rejectionReasons,
  },
  performance: {
    totalLatencyMs: latencies.reduce((total, latency) => total + latency, 0),
    averageBatchLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((total, latency) => total + latency, 0) / latencies.length) : 0,
    p50BatchLatencyMs: percentile(.5),
    p95BatchLatencyMs: percentile(.95),
    inputTokens,
    outputTokens,
    totalTokens,
  },
  batchResults,
  candidateSummaries,
}

await mkdir(resolve('output/model-evaluation'), { recursive: true })
const outputPath = resolve(`output/model-evaluation/${policy.model}.cluster-schema.no-thinking.batch-${evaluationBatchSize}.limit-${Math.min(themeLimit, work.themes.length)}.json`)
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ outputPath, ...report, candidateSummaries: undefined })}\n`)
