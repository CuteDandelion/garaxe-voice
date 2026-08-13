// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Database } from './database'
import { createClusterWorkerPolls } from './runtime'

describe('cluster worker runtime', () => {
  it('creates and settles one worker for authenticated and Demo persistence', async () => {
    const authenticated = { name: 'authenticated' } as unknown as Database
    const demo = { name: 'demo' } as unknown as Database
    const runOnce = vi.fn(async () => undefined)
    const createWorker = vi.fn(async (_database: Database) => ({ runOnce }))
    const settle = vi.fn(async (_database: Database) => undefined)

    const polls = await createClusterWorkerPolls([authenticated, demo], createWorker, settle)
    expect(createWorker.mock.calls.map(([database]) => database)).toEqual([authenticated, demo])

    await Promise.all(polls.map((poll) => poll()))
    expect(runOnce).toHaveBeenCalledTimes(2)
    expect(settle.mock.calls.map(([database]) => database)).toEqual(expect.arrayContaining([authenticated, demo]))
  })
})
