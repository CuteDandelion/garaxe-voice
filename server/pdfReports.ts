import { access, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

async function available(path: string) {
  try { await access(path, constants.X_OK); return true } catch { return false }
}

async function pythonExecutable() {
  if (process.env.GARAXE_PYTHON) return process.env.GARAXE_PYTHON
  const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')
  return await available(bundled) ? bundled : 'python3'
}

export async function renderReportPdf(snapshot: Record<string, unknown>) {
  const output = join(tmpdir(), `garaxe-report-${randomUUID()}.pdf`)
  const script = resolve(process.cwd(), 'scripts/render-report.py')
  const python = await pythonExecutable()
  try {
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(python, [script, output], { stdio: ['pipe', 'ignore', 'pipe'] })
      let errors = ''
      child.stderr.on('data', (chunk) => { errors += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolveRun() : reject(new Error(errors || `PDF renderer exited with ${code}.`)))
      child.stdin.end(JSON.stringify(snapshot))
    })
    return await readFile(output)
  } finally {
    await rm(output, { force: true })
  }
}
