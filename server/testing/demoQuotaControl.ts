import { randomBytes } from 'node:crypto'

export type DemoQuotaTestControl = {
  token: string
  now: () => Date
  advance: (milliseconds: number) => Date
  reset: (date?: Date) => Date
}

export function createDemoQuotaTestControl(start = new Date()): DemoQuotaTestControl {
  let current = new Date(start)
  return {
    token: randomBytes(24).toString('base64url'),
    now: () => new Date(current),
    advance: (milliseconds) => new Date(current = new Date(current.getTime() + milliseconds)),
    reset: (date = start) => new Date(current = new Date(date)),
  }
}
