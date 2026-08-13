import type { Database } from './database'
import { createClusterInterpretationWorker, settleClusterInterpretationRuns } from './clusterInterpretation'

type ClusterWorker = { runOnce(): Promise<unknown> }

export async function createClusterWorkerPolls(
  databases: Database[],
  createWorker: (database: Database) => Promise<ClusterWorker | null> = createClusterInterpretationWorker,
  settle: (database: Database) => Promise<unknown> = settleClusterInterpretationRuns,
) {
  const workers = await Promise.all(databases.map(async (database) => ({ database, worker: await createWorker(database) })))
  return workers.flatMap(({ database, worker }) => worker
    ? [async () => { await worker.runOnce(); await settle(database) }]
    : [])
}
