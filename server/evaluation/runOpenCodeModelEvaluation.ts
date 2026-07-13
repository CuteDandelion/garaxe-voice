import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openCodeGoProviderFromEnv } from '../llmProvider'
import { LLM_CANDIDATE_SCHEMA_VERSION, loadLlmEvaluationFixture, scoreLlmCandidate } from './llmCandidateEvaluator'

const fixturePath = resolve(process.argv[2] || 'server/fixtures/llm-analysis-gold-50.json')
const noThinking = process.argv.includes('--no-thinking')
const models = process.argv.slice(3).filter((argument) => argument !== '--no-thinking')
if (models.length === 0) throw new Error('Pass at least one model ID.')
const provider = openCodeGoProviderFromEnv()
if (!provider) throw new Error('OPENCODE_GO_API_KEY is not configured.')
const fixture = await loadLlmEvaluationFixture(fixturePath)
const labels = [...new Set(fixture.reviews.flatMap((review) => review.expectedSignals.map((signal) => signal.label)))].sort()
const reviews = fixture.reviews.map(({ id, text }) => ({ id, text }))
const system = `You extract customer-review signals. Return JSON only using schema {"schemaVersion":"${LLM_CANDIDATE_SCHEMA_VERSION}","signals":[{"reviewId":string,"signalType":"pain_point"|"desired_outcome"|"objection"|"emotion","label":string,"quoteText":string,"quoteStart":integer,"quoteEnd":integer}]}. Extract at most one dominant signal per review. quoteText must be an exact substring and offsets use JavaScript string indexes with quoteEnd exclusive. Use only these labels: ${labels.join(', ')}. Do not add explanations.`

await mkdir(resolve('output/model-evaluation'), { recursive: true })
for (const model of models) {
  const artifactName = `${model}${noThinking ? '.no-thinking' : ''}`
  const started = Date.now()
  const batches = Array.from({ length: Math.ceil(reviews.length / 10) }, (_, index) => reviews.slice(index * 10, index * 10 + 10))
  const signals: unknown[] = []
  const raw: string[] = []
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let finishReason: string | null = null
  let failedBatches = 0
  for (const batch of batches) {
    try {
      const result = await provider.complete({
        model,
        maxTokens: 5_000,
        temperature: 0,
        json: true,
        enableThinking: noThinking ? false : undefined,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ reviews: batch }) }],
      })
      raw.push(result.content)
      finishReason = result.finishReason
      inputTokens += result.usage.inputTokens || 0
      outputTokens += result.usage.outputTokens || 0
      totalTokens += result.usage.totalTokens || 0
      const jsonText = result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const batchCandidate = JSON.parse(jsonText) as { signals?: unknown[] }
      if (Array.isArray(batchCandidate.signals)) signals.push(...batchCandidate.signals)
      else failedBatches += 1
    } catch (error) {
      failedBatches += 1
      raw.push(`[batch failed: ${error instanceof Error ? error.name : 'unknown'}]`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const latencyMs = Date.now() - started
  await writeFile(resolve(`output/model-evaluation/${artifactName}.raw.txt`), raw.join('\n\n--- batch ---\n\n'))
  const candidate: Record<string, unknown> = {
    schemaVersion: failedBatches === 0 ? LLM_CANDIDATE_SCHEMA_VERSION : 'incomplete-provider-output',
    model,
    enableThinking: noThinking ? false : null,
    signals,
    usage: { inputTokens, outputTokens, totalTokens },
    latencyMs,
  }
  const score = scoreLlmCandidate(fixture, candidate)
  await writeFile(resolve(`output/model-evaluation/${artifactName}.candidate.json`), `${JSON.stringify(candidate, null, 2)}\n`)
  await writeFile(resolve(`output/model-evaluation/${artifactName}.score.json`), `${JSON.stringify(score, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ model, enableThinking: noThinking ? false : null, finishReason, failedBatches, ...score })}\n`)
}
