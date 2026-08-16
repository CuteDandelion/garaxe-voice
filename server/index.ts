import { createServer } from 'node:http'
import { handleRequest } from './app'
import { closeDatabase, getDatabase, getDemoDatabase } from './db'
import { cleanupExpiredDemoAnalysisSessions } from './demoAnalysis'
import { createClusterWorkerPolls } from './runtime'

const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'
const server = createServer((request, response) => void handleRequest(request, response))
const database = await getDatabase()
const demoDatabase = await getDemoDatabase()
await cleanupExpiredDemoAnalysisSessions(demoDatabase)
const demoCleanupTimer = setInterval(() => void cleanupExpiredDemoAnalysisSessions(demoDatabase).catch(() => {
  console.error('Temporary demo expiry sweep failed.')
}), 60_000)
demoCleanupTimer.unref()
const workerConcurrency = Math.max(1, Math.min(5, Number(process.env.GARAXE_LLM_PROVIDER_CONCURRENCY || 2)))
const workerTimers = (await createClusterWorkerPolls([database, demoDatabase], undefined, undefined, workerConcurrency)).map((run) => {
  const poll = () => void run().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240) : 'UNKNOWN_WORKER_ERROR'
    console.error(`Cluster interpretation worker iteration failed: ${reason}`)
  })
  poll()
  const timer = setInterval(poll, 1_000)
  timer.unref()
  return timer
})

server.listen(port, host, () => {
  console.log(`Garaxe API ready at http://${host}:${port}`)
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Garaxe API received ${signal}; shutting down.`)
  for (const timer of workerTimers) clearInterval(timer)
  clearInterval(demoCleanupTimer)

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
