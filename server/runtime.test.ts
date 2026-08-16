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

  it('runs bounded worker slots but never overlaps settle cycles for one database', async () => {
    const database = { name: 'authenticated' } as unknown as Database
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const runOnce = vi.fn(async () => blocked)
    const settle = vi.fn(async () => undefined)
    const [poll] = await createClusterWorkerPolls([database], async () => ({ runOnce }), settle, 2)

    const first = poll()
    const overlapping = poll()
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2))
    expect(settle).not.toHaveBeenCalled()

    release()
    await Promise.all([first, overlapping])
    expect(runOnce).toHaveBeenCalledTimes(2)
    expect(settle).toHaveBeenCalledTimes(1)

    await poll()
    expect(runOnce).toHaveBeenCalledTimes(4)
    expect(settle).toHaveBeenCalledTimes(2)
  })
})
