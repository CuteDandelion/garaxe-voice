// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('customer-facing brand metadata', () => {
  it('publishes Voice Lab by Elseform at the canonical domain', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

    expect(html).toContain('<link rel="canonical" href="https://voicelab.elseform.tech/"')
    expect(html).toContain('<meta property="og:site_name" content="Voice Lab by Elseform"')
    expect(html).toContain('<meta property="og:url" content="https://voicelab.elseform.tech/"')
    expect(html).not.toMatch(/Garaxe|misakirose/i)
  })
})
