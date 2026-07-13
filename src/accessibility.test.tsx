import axe from 'axe-core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

async function violations() {
  const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })
  return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }))
}

describe('application accessibility', () => {
  it('has no detectable structural accessibility violations across delivered workspaces', async () => {
    document.documentElement.lang = 'en'
    document.title = 'garaxe.voice'
    render(<App />)
    const navigation = await screen.findByRole('complementary', { name: 'Project navigation' })
    expect(await violations()).toEqual([])
    const delivered = [
      ['Pain Phrases', 'Where the experience breaks down.'],
      ['Outcomes', 'What customers are trying to reach.'],
      ['Objections', 'What makes customers hesitate.'],
      ['Emotional Triggers', 'The feeling underneath the feedback.'],
      ['Copy Lab', 'Build from customer language.'],
    ] as const
    for (const [label, heading] of delivered) {
      fireEvent.click(within(navigation).getByRole('button', { name: label }))
      await screen.findByRole('heading', { name: heading })
      expect(await violations()).toEqual([])
    }
    fireEvent.click(within(navigation).getByRole('button', { name: 'Sources' }))
    await screen.findByRole('heading', { name: 'Bring in the words your customers already use.' })
    expect(await violations()).toEqual([])
  })
})
