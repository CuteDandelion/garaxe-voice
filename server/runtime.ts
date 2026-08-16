import type { Database } from './database'
import { createClusterInterpretationWorker, settleClusterInterpretationRuns } from './clusterInterpretation'

type ClusterWorker = { runOnce(): Promise<unknown> }

export async function createClusterWorkerPolls(
  databases: Database[],
  createWorker: (database: Database) => Promise<ClusterWorker | null> = createClusterInterpretationWorker,
  settle: (database: Database) => Promise<unknown> = settleClusterInterpretationRuns,
  concurrency = 1,
) {
  const slots = Math.max(1, Math.min(5, Math.floor(concurrency)))
  const workers = await Promise.all(databases.map(async (database) => ({ database, worker: await createWorker(database) })))
  return workers.flatMap(({ database, worker }) => {
    if (!worker) return []
    let current: Promise<void> | null = null
    return [() => {
      if (current) return current
      current = (async () => {
        await Promise.all(Array.from({ length: slots }, () => worker.runOnce()))
        await settle(database)
      })().finally(() => { current = null })
      return current
    }]
  })
}
