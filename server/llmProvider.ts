export type LlmChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type LlmCompletion = {
  provider: 'opencode_go'
  model: string
  content: string
  finishReason: string | null
  usage: LlmUsage
  requestId: string | null
}

export type LlmProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'

export class LlmProviderError extends Error {
  constructor(
    public readonly code: LlmProviderErrorCode,
    message: string,
    public readonly retryAfterMs: number | null = null,
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'LlmProviderError'
  }
}

export type OpenCodeGoOptions = {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export type CompleteRequest = {
  model: string
  messages: LlmChatMessage[]
  maxTokens: number
  temperature?: number
  json?: boolean
  enableThinking?: boolean
  signal?: AbortSignal
}

type ProviderPayload = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

function errorFor(response: Response) {
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
  if (response.status === 401 || response.status === 403) return new LlmProviderError('AUTHENTICATION_FAILED', 'The LLM provider rejected the configured credential.', null, response.status)
  if (response.status === 404) return new LlmProviderError('MODEL_UNAVAILABLE', 'The selected LLM model is unavailable.', null, response.status)
  if (response.status === 429) return new LlmProviderError('RATE_LIMITED', 'The LLM provider rate limited the request.', retryAfter, response.status)
  return new LlmProviderError('PROVIDER_UNAVAILABLE', 'The LLM provider could not complete the request.', retryAfter, response.status)
}

export class OpenCodeGoProvider {
  private readonly baseUrl: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: OpenCodeGoOptions) {
    if (!options.apiKey.trim()) throw new Error('OpenCode Go API key is required.')
    this.baseUrl = (options.baseUrl || 'https://opencode.ai/zen/go/v1').replace(/\/$/, '')
    this.request = options.fetch || globalThis.fetch
    this.timeoutMs = options.timeoutMs || 60_000
  }

  async complete(input: CompleteRequest): Promise<LlmCompletion> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.request(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature ?? 0,
          ...(typeof input.enableThinking === 'boolean' ? { enable_thinking: input.enableThinking } : {}),
          ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      })
    } catch (error) {
      if (error instanceof LlmProviderError) throw error
      throw new LlmProviderError('PROVIDER_UNAVAILABLE', 'The LLM provider request did not complete.')
    }
    if (!response.ok) throw errorFor(response)

    let payload: ProviderPayload
    try { payload = await response.json() as ProviderPayload } catch {
      throw new LlmProviderError('INVALID_RESPONSE', 'The LLM provider returned invalid JSON.', null, response.status)
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmProviderError('INVALID_RESPONSE', 'The LLM provider returned no usable completion.', null, response.status)
    }
    return {
      provider: 'opencode_go',
      model: input.model,
      content,
      finishReason: typeof payload.choices?.[0]?.finish_reason === 'string' ? payload.choices[0].finish_reason : null,
      usage: {
        inputTokens: numberOrNull(payload.usage?.prompt_tokens),
        outputTokens: numberOrNull(payload.usage?.completion_tokens),
        totalTokens: numberOrNull(payload.usage?.total_tokens),
      },
      requestId: response.headers.get('x-request-id'),
    }
  }
}

export function openCodeGoProviderFromEnv(environment: NodeJS.ProcessEnv = process.env) {
  const apiKey = environment.OPENCODE_GO_API_KEY
  if (!apiKey) return null
  const configuredTimeout = Number(environment.OPENCODE_GO_TIMEOUT_MS)
  return new OpenCodeGoProvider({
    apiKey,
    baseUrl: environment.OPENCODE_GO_BASE_URL,
    ...(Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? { timeoutMs: configuredTimeout } : {}),
  })
}
