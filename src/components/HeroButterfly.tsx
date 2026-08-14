import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from 'react'
import './HeroButterfly.css'

const scrollFlightKey = 'voice-lab:hero-butterfly-flown'
let fallbackFlight = false

function hasFlown() {
  try { return sessionStorage.getItem(scrollFlightKey) === 'true' } catch { return fallbackFlight }
}

function rememberFlight() {
  try { sessionStorage.setItem(scrollFlightKey, 'true') } catch { fallbackFlight = true }
}

type FlightStyle = CSSProperties & Record<`--flight-${string}`, string>

export function HeroButterfly({ targetId, onActivate }: { targetId: string; onActivate: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const passiveDone = useRef(hasFlown())
  const [motion, setMotion] = useState<'idle' | 'gliding' | 'flying'>('idle')
  const [flightStyle, setFlightStyle] = useState<FlightStyle>()
  const [reducedMotion, setReducedMotion] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (reducedMotion || passiveDone.current) return
    const onScroll = () => {
      const button = buttonRef.current
      if (!button || window.scrollY < 80 || passiveDone.current) return
      const rect = button.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) return
      passiveDone.current = true
      rememberFlight()
      setMotion('gliding')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [reducedMotion])

  const complete = () => {
    const target = document.getElementById(targetId)
    target?.focus({ preventScroll: true })
    onActivate()
  }

  const activate = () => {
    if (motion === 'flying') return
    passiveDone.current = true
    rememberFlight()
    if (reducedMotion) { complete(); return }
    const button = buttonRef.current
    const target = document.getElementById(targetId)
    if (!button || !target) { complete(); return }
    const from = button.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    const x = to.left + to.width / 2 - (from.left + from.width / 2)
    const y = to.top + to.height / 2 - (from.top + from.height / 2)
    setFlightStyle({
      '--flight-x1': `${x * .28 + 70}px`, '--flight-y1': `${y * .2 - 28}px`,
      '--flight-x2': `${x * .68 + 92}px`, '--flight-y2': `${y * .62 - 38}px`,
      '--flight-x3': `${x}px`, '--flight-y3': `${y}px`,
    })
    setMotion('flying')
  }

  const onAnimationEnd = (event: AnimationEvent<HTMLButtonElement>) => {
    if (event.target !== event.currentTarget) return
    if (motion === 'gliding') setMotion('idle')
    if (motion === 'flying') { setMotion('idle'); complete() }
  }

  return <button
    ref={buttonRef}
    type="button"
    className={`hero-butterfly${motion === 'gliding' ? ' is-gliding' : ''}${motion === 'flying' ? ' is-flying' : ''}`}
    style={flightStyle}
    aria-label="Follow the butterfly to try Voice Lab"
    onClick={activate}
    onAnimationEnd={onAnimationEnd}
  >
    <svg viewBox="0 0 64 48" aria-hidden="true" focusable="false">
      <path className="hero-butterfly__wing hero-butterfly__wing--left" data-wing="left" d="M30 22C22 5 6 3 5 14c-1 10 11 15 25 13Z" />
      <path className="hero-butterfly__wing hero-butterfly__wing--right" data-wing="right" d="M34 22C42 5 58 3 59 14c1 10-11 15-25 13Z" />
      <path className="hero-butterfly__body" d="M32 17c3 0 4 5 4 12s-2 13-4 13-4-6-4-13 1-12 4-12Zm-1-1c-4-5-7-6-9-5m11 5c4-5 7-6 9-5" />
    </svg>
  </button>
}
