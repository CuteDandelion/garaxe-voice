import { createHash } from 'node:crypto'
import { validatePairAdjudications, type PairAdjudicationCandidate } from '../server/clusterInterpretation'

export type CapturedPairBatch = {
  url: string
  requestBody: string
  pairs: PairAdjudicationCandidate[]
  originalDecisions: Array<{ pairId: string; sameTopic: boolean }>
}

type ReplayAttempt = { sameTopic: boolean | null; schemaValid: boolean; responseHash: string; latencyMs: number }

const pairId = (left: string, right: string) => [left, right].sort().join('::')

export function capturePairExchange(url: string, requestBody: string, responseContent: string): CapturedPairBatch | null {
  try {
    const request = JSON.parse(requestBody)
    const userMessage = request.messages?.find((message: { role?: string }) => message.role === 'user')
    const pairs = JSON.parse(userMessage?.content || '').pairs as PairAdjudicationCandidate[]
    if (!Array.isArray(pairs) || !pairs.length) return null
    const originalDecisions = validatePairAdjudications(pairs, JSON.parse(responseContent))
    return { url, requestBody, pairs, originalDecisions }
  } catch { return null }
}

export async function replayObservedPairErrors(input: {
  captures: CapturedPairBatch[]
  runtimeToBlind: Map<string, string>
  expectedByPair: Map<string, boolean>
  request(url: string, body: string): Promise<{ content: string; latencyMs: number }>
}) {
  const targets = new Map<string, { batch: CapturedPairBatch; runtimePairId: string; attempts: ReplayAttempt[] }>()
  for (const batch of input.captures) for (const decision of batch.originalDecisions) {
    const [left, right] = decision.pairId.split('::')
    const blindLeft = input.runtimeToBlind.get(left)
    const blindRight = input.runtimeToBlind.get(right)
    if (!blindLeft || !blindRight) continue
    const blindPairId = pairId(blindLeft, blindRight)
    const expected = input.expectedByPair.get(blindPairId)
    if (expected !== undefined && expected !== decision.sameTopic) {
      targets.set(blindPairId, { batch, runtimePairId: decision.pairId, attempts: [] })
    }
  }

  for (const batch of new Set([...targets.values()].map((target) => target.batch))) {
    const batchTargets = [...targets.values()].filter((target) => target.batch === batch)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await input.request(batch.url, batch.requestBody)
      const responseHash = createHash('sha256').update(response.content).digest('hex')
      let decisions: Array<{ pairId: string; sameTopic: boolean }> | null = null
      try {
        decisions = validatePairAdjudications(batch.pairs, JSON.parse(response.content))
      } catch { /* schema-invalid output is diagnostic data */ }
      for (const target of batchTargets) target.attempts.push({
        sameTopic: decisions?.find((decision) => decision.pairId === target.runtimePairId)?.sameTopic ?? null,
        schemaValid: decisions !== null,
        responseHash,
        latencyMs: response.latencyMs,
      })
    }
  }

  return [...targets.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([blindPairId, target]) => ({
      pairId: blindPairId,
      contextHash: createHash('sha256').update(target.batch.requestBody).digest('hex'),
      attempts: target.attempts,
    }))
}
