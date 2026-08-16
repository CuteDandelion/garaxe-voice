// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRequest } from './app'
import { getDatabase } from './db'
import { PGlite } from '@electric-sql/pglite'
import { collectLocalPerformanceDiagnostics } from './performanceDiagnostics'

describe('local performance diagnostics boundary', () => {
  let server: Server
  let baseUrl = ''
  let report = {
    generatedAt: '2026-08-14T12:00:00.000Z',
    window: { from: '2026-08-14T11:50:00.000Z', to: '2026-08-14T12:00:00.000Z', samplingIntervalMs: 2_000 },
    runs: [{
      runId: '11111111-1111-4111-8111-111111111111', lane: 'authenticated', userLabel: 'user-1', stage: 'Interpreting', progressPercent: 72,
      timings: { parseValidateMs: 12, csvSaveMs: 140, queueWaitMs: 500, firstEvidenceMs: 9_000, completionMs: 20_000, aggregationPersistMs: 200 },
      queue: { queued: 2, active: 1, leaseState: 'Waiting for intelligence capacity' },
      llm: { requests: 10, retries: 0, durationMs: 18_000 },
      jobs: [{ jobId: 'job-1', status: 'Running intelligence', queueWaitMs: 500, progressPercent: 50, retries: 0, elapsedMs: 4_000, prompt: 'must never leave' }],
      resources: [{ sampledAt: '2026-08-14T11:55:00.000Z', service: 'api', cpuPercent: 12.5, rssMiB: 380, heapMiB: 120 }],
      rawFeedback: 'must never leave the diagnostics collector',
    }],
    fairness: { users: 3, p50FirstEvidenceMs: 10_000, p95FirstEvidenceMs: 12_000, completionSpreadMs: 2_000, starvedUsers: 0, comparisons: [{ userLabel: 'user-1', queueWaitMs: 500, firstEvidenceMs: 9_000, completionMs: 20_000, progressPercent: 100, secret: 'must never leave' }] },
  }

  beforeAll(async () => {
    process.env.GARAXE_LOCAL_PERFORMANCE_DIAGNOSTICS = 'true'
    server = createServer((request, response) => void handleRequest(request, response, { performanceDiagnostics: async () => report }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Diagnostics test server did not start.')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    delete process.env.GARAXE_LOCAL_PERFORMANCE_DIAGNOSTICS
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('allows flagged loopback access without credentials and returns only allowlisted metrics', async () => {
    const response = await fetch(`${baseUrl}/api/_test/performance-diagnostics`)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.runs[0]).toMatchObject({ runId: report.runs[0].runId, stage: 'Interpreting', llm: { requests: 10, retries: 0 }, jobs: [{ status: 'Running intelligence', progressPercent: 50 }] })
    expect(payload.data.fairness.comparisons).toEqual([{ userLabel: 'user-1', queueWaitMs: 500, firstEvidenceMs: 9_000, completionMs: 20_000, progressPercent: 100 }])
    expect(JSON.stringify(payload)).not.toContain('must never leave')

    report = { ...report, runs: report.runs.map((run) => ({ ...run, stage: 'Building overview', progressPercent: 91 })) }
    const advanced = await fetch(`${baseUrl}/api/_test/performance-diagnostics`)
    await expect(advanced.json()).resolves.toMatchObject({ data: { runs: [{ stage: 'Building overview', progressPercent: 91 }] } })
  })

  it('is a hard 404 in production even when the local flag and provider are present', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const response = await fetch(`${baseUrl}/api/_test/performance-diagnostics`)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('reports first usable evidence only after every extraction job succeeds', async () => {
    const database = new PGlite()
    await database.exec(`
      CREATE TABLE analysis_runs (id TEXT PRIMARY KEY,status TEXT NOT NULL,stage TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,completed_at TIMESTAMPTZ);
      CREATE TABLE llm_jobs (id TEXT PRIMARY KEY,analysis_run_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL,available_at TIMESTAMPTZ NOT NULL,last_leased_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL);
      INSERT INTO analysis_runs VALUES ('run-1','running','interpreting_clusters','2026-08-14T12:00:00Z',NULL);
      INSERT INTO llm_jobs VALUES
        ('job-1','run-1','emerging_signal_interpretation:1','succeeded',1,'2026-08-14T12:00:00Z','2026-08-14T12:00:00Z','2026-08-14T12:00:01Z','2026-08-14T12:00:05Z','2026-08-14T12:00:05Z'),
        ('job-2','run-1','emerging_signal_interpretation:2','queued',0,'2026-08-14T12:00:00Z','2026-08-14T12:00:00Z',NULL,NULL,'2026-08-14T12:00:00Z');
    `)
    const partial = await collectLocalPerformanceDiagnostics([{ database: database as never, lane: 'authenticated' }], {})
    expect(partial.runs[0]?.timings.firstEvidenceMs).toBe(0)
    await database.exec(`UPDATE llm_jobs SET state='succeeded',attempt_count=1,last_leased_at='2026-08-14T12:00:06Z',completed_at='2026-08-14T12:00:10Z',updated_at='2026-08-14T12:00:10Z' WHERE id='job-2'`)
    const complete = await collectLocalPerformanceDiagnostics([{ database: database as never, lane: 'authenticated' }], {})
    expect(complete.runs[0]?.timings.firstEvidenceMs).toBe(10_000)
    await database.close()
  })
})
