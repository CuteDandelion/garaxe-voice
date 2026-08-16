export function safeSourceUrl(value: string | null | undefined, allowLoopbackHttp = false) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url.href
    if (allowLoopbackHttp && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.href
  } catch {
    // Invalid source URLs are untrusted input, not links.
  }
  return null
}
