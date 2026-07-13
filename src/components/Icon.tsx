import type { LucideIcon } from 'lucide-react'

type IconProps = {
  icon: LucideIcon
  size?: number
  strokeWidth?: number
}

export function Icon({ icon: Glyph, size = 17, strokeWidth = 1.45 }: IconProps) {
  return <Glyph aria-hidden="true" size={size} strokeWidth={strokeWidth} />
}
