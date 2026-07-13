import { createServer } from 'node:http'
import { handleRequest } from './app'
import { getDatabase } from './db'
import { createClusterInterpretationWorker, settleClusterInterpretationRuns } from './clusterInterpretation'

const port = Number(process.env.API_PORT || 3001)
const server = createServer((request, response) => void handleRequest(request, response))

server.listen(port, '127.0.0.1', () => {
  console.log(`Garaxe API ready at http://127.0.0.1:${port}`)
})

const database = await getDatabase()
const clusterWorker = await createClusterInterpretationWorker(database)
if (clusterWorker) {
  const poll = () => void clusterWorker.runOnce().then(() => settleClusterInterpretationRuns(database)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240) : 'UNKNOWN_WORKER_ERROR'
    console.error(`Cluster interpretation worker iteration failed: ${reason}`)
  })
  poll()
  setInterval(poll, 1_000).unref()
}
