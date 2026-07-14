import { createServer } from 'node:http'
import { handleRequest } from './app'
import { closeDatabase, getDatabase } from './db'
import { createClusterInterpretationWorker, settleClusterInterpretationRuns } from './clusterInterpretation'

const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'
const server = createServer((request, response) => void handleRequest(request, response))
const database = await getDatabase()
const clusterWorker = await createClusterInterpretationWorker(database)
let workerTimer: NodeJS.Timeout | undefined
if (clusterWorker) {
  const poll = () => void clusterWorker.runOnce().then(() => settleClusterInterpretationRuns(database)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240) : 'UNKNOWN_WORKER_ERROR'
    console.error(`Cluster interpretation worker iteration failed: ${reason}`)
  })
  poll()
  workerTimer = setInterval(poll, 1_000)
  workerTimer.unref()
}

server.listen(port, host, () => {
  console.log(`Garaxe API ready at http://${host}:${port}`)
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Garaxe API received ${signal}; shutting down.`)
  if (workerTimer) clearInterval(workerTimer)

  const forceExit = setTimeout(() => {
    console.error('Garaxe API graceful shutdown timed out.')
    server.closeAllConnections()
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await closeDatabase()
  clearTimeout(forceExit)
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
