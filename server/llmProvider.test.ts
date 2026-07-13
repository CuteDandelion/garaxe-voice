import { describe, expect, it, vi } from 'vitest'
import { LlmProviderError, OpenCodeGoProvider, openCodeGoProviderFromEnv, parseRetryAfter } from './llmProvider'

describe('OpenCode Go provider adapter', () => {
  it('returns normalized content and usage without returning credentials', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"label":"negative"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    }), { status: 200, headers: { 'x-request-id': 'provider-request-1' } }))
    const provider = new OpenCodeGoProvider({ apiKey: 'secret-value', fetch: request as typeof fetch })

    const result = await provider.complete({ model: 'cheap-model', maxTokens: 100, json: true, enableThinking: false, messages: [{ role: 'user', content: 'Classify this.' }] })

    expect(result).toEqual({ provider: 'opencode_go', model: 'cheap-model', content: '{"label":"negative"}', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 }, requestId: 'provider-request-1' })
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(request).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit).body))).toMatchObject({ enable_thinking: false })
  })

  it('maps 429 responses to safe retry metadata without response-body leakage', async () => {
    const provider = new OpenCodeGoProvider({ apiKey: 'secret', fetch: (async () => new Response('sensitive quota details', { status: 429, headers: { 'retry-after': '3' } })) as typeof fetch })
    await expect(provider.complete({ model: 'cheap-model', maxTokens: 20, messages: [{ role: 'user', content: 'test' }] })).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 3_000, status: 429 })
    try { await provider.complete({ model: 'cheap-model', maxTokens: 20, messages: [{ role: 'user', content: 'test' }] }) } catch (error) {
      expect((error as Error).message).not.toContain('sensitive quota details')
    }
  })

  it('supports numeric and HTTP-date Retry-After values', () => {
    expect(parseRetryAfter('2')).toBe(2_000)
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:04 GMT', Date.parse('2026-01-01T00:00:00Z'))).toBe(4_000)
  })

  it('stays disabled when the API key is absent', () => {
    expect(openCodeGoProviderFromEnv({})).toBeNull()
    expect(() => new OpenCodeGoProvider({ apiKey: ' ' })).toThrow('API key is required')
    expect(new LlmProviderError('INVALID_RESPONSE', 'safe')).toBeInstanceOf(Error)
  })
})
