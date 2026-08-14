import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroButterfly } from './HeroButterfly'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderButterfly(reducedMotion = false) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  const onActivate = vi.fn()
  const view = render(<><HeroButterfly targetId="hero-demo" onActivate={onActivate} /><button id="hero-demo">Try the demo</button></>)
  return { butterfly: screen.getByRole('button', { name: 'Follow the butterfly to try Voice Lab' }), target: screen.getByRole('button', { name: 'Try the demo' }), onActivate, unmount: view.unmount }
}

describe('HeroButterfly', () => {
  it('is a semantic inline SVG control with independently articulated wings', () => {
    const { butterfly } = renderButterfly()

    expect(butterfly).toHaveAttribute('type', 'button')
    expect(butterfly.querySelector('svg')).toBeInTheDocument()
    expect(butterfly.querySelectorAll('[data-wing]')).toHaveLength(2)
  })

  it('flies once, then focuses and activates the inspected hero CTA', () => {
    const { butterfly, target, onActivate } = renderButterfly()

    fireEvent.click(butterfly)
    expect(butterfly).toHaveClass('is-flying')
    expect(onActivate).not.toHaveBeenCalled()

    fireEvent.animationEnd(butterfly, { animationName: 'butterfly-flight' })
    expect(target).toHaveFocus()
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('skips motion but preserves focus and navigation for reduced motion', () => {
    const { butterfly, target, onActivate } = renderButterfly(true)

    fireEvent.click(butterfly)
    expect(butterfly).not.toHaveClass('is-flying')
    expect(target).toHaveFocus()
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('flies subtly once per page session after a meaningful in-viewport scroll without navigating', () => {
    const first = renderButterfly()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(first.butterfly, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 168 } as DOMRect)

    fireEvent.scroll(window)
    expect(first.butterfly).toHaveClass('is-gliding')
    expect(first.target).not.toHaveFocus()
    expect(first.onActivate).not.toHaveBeenCalled()
    fireEvent.animationEnd(first.butterfly, { animationName: 'butterfly-glide' })
    expect(first.butterfly).not.toHaveClass('is-gliding')

    first.unmount()
    const second = renderButterfly()
    vi.spyOn(second.butterfly, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 168 } as DOMRect)
    fireEvent.scroll(window)
    expect(second.butterfly).not.toHaveClass('is-gliding')
  })

  it('cancels the passive scroll flight when click activation happens first', () => {
    const { butterfly, onActivate } = renderButterfly()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    vi.spyOn(butterfly, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 168 } as DOMRect)

    fireEvent.click(butterfly)
    fireEvent.scroll(window)
    expect(butterfly).toHaveClass('is-flying')
    expect(butterfly).not.toHaveClass('is-gliding')
    fireEvent.animationEnd(butterfly, { animationName: 'butterfly-flight' })
    expect(onActivate).toHaveBeenCalledOnce()
  })
})
