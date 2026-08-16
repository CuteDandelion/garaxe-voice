// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { capturePairExchange, replayObservedPairErrors, type CapturedPairBatch } from './voice-map-pair-repeatability'

const requestBody = JSON.stringify({
  model: 'fixed-model',
  messages: [
    { role: 'system', content: 'fixed pair prompt' },
    { role: 'user', content: JSON.stringify({ pairs: [
      { pairId: 'runtime-a::runtime-b', left: {}, right: {} },
      { pairId: 'runtime-c::runtime-d', left: {}, right: {} },
      { pairId: 'runtime-e::runtime-f', left: {}, right: {} },
    ] }) },
  ],
  max_tokens: 1800,
  temperature: 0,
  enable_thinking: false,
  response_format: { type: 'json_object' },
})

const captured: CapturedPairBatch = {
  url: 'https://provider.invalid/chat/completions',
  requestBody,
  pairs: JSON.parse(JSON.parse(requestBody).messages[1].content).pairs,
  originalDecisions: [
    { pairId: 'runtime-a::runtime-b', sameTopic: false },
    { pairId: 'runtime-c::runtime-d', sameTopic: true },
    { pairId: 'runtime-e::runtime-f', sameTopic: true },
  ],
}

describe('blinded pair-adjudication repeatability', () => {
  it('captures the exact request body and validated decisions without headers', () => {
    const exchange = capturePairExchange(
      'https://provider.invalid/chat/completions', requestBody,
      JSON.stringify({ decisions: captured.originalDecisions }),
    )

    expect(exchange).toEqual(captured)
    expect(exchange && 'headers' in exchange).toBe(false)
  })

  it('replays only observed reviewed errors three times with the byte-identical batch body', async () => {
    const bodies: string[] = []
    const responses = [false, true, false]
    const diagnostics = await replayObservedPairErrors({
      captures: [captured],
      runtimeToBlind: new Map([
        ['runtime-a', 'blind-001'], ['runtime-b', 'blind-041'],
        ['runtime-c', 'blind-004'], ['runtime-d', 'blind-084'],
        ['runtime-e', 'blind-003'], ['runtime-f', 'blind-043'],
      ]),
      expectedByPair: new Map([
        ['blind-001::blind-041', true],
        ['blind-004::blind-084', false],
        ['blind-003::blind-043', true],
      ]),
      request: async (_url, body) => {
        bodies.push(body)
        const sameTopic = responses[bodies.length - 1]
        return { content: JSON.stringify({ decisions: [
          { pairId: 'runtime-a::runtime-b', sameTopic },
          { pairId: 'runtime-c::runtime-d', sameTopic: !sameTopic },
          { pairId: 'runtime-e::runtime-f', sameTopic: true },
        ] }), latencyMs: bodies.length }
      },
    })

    expect(bodies).toEqual([requestBody, requestBody, requestBody])
    expect(diagnostics.map((item) => item.pairId)).toEqual(['blind-001::blind-041', 'blind-004::blind-084'])
    expect(diagnostics[0].attempts.map((attempt) => attempt.sameTopic)).toEqual([false, true, false])
    expect(diagnostics[1].attempts.map((attempt) => attempt.sameTopic)).toEqual([true, false, true])
    expect(diagnostics.flatMap((item) => item.attempts).every((attempt) => attempt.schemaValid)).toBe(true)
    expect(diagnostics[0].contextHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.keys(diagnostics[0])).toEqual(['pairId', 'contextHash', 'attempts'])
    expect(Object.keys(diagnostics[0].attempts[0])).toEqual(['sameTopic', 'schemaValid', 'responseHash', 'latencyMs'])
  })

  it('marks malformed replay responses invalid without inventing a semantic outcome', async () => {
    const diagnostics = await replayObservedPairErrors({
      captures: [captured],
      runtimeToBlind: new Map([
        ['runtime-a', 'blind-001'], ['runtime-b', 'blind-041'],
        ['runtime-c', 'blind-004'], ['runtime-d', 'blind-084'],
        ['runtime-e', 'blind-003'], ['runtime-f', 'blind-043'],
      ]),
      expectedByPair: new Map([
        ['blind-001::blind-041', true], ['blind-004::blind-084', false], ['blind-003::blind-043', true],
      ]),
      request: async () => ({ content: '{"decisions":[]}', latencyMs: 7 }),
    })

    expect(diagnostics.every((item) => item.attempts.every((attempt) =>
      attempt.sameTopic === null && !attempt.schemaValid && attempt.latencyMs === 7))).toBe(true)
  })
})
