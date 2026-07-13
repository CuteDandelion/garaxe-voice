import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLlmEvaluationFixture, scoreLlmCandidate } from './llmCandidateEvaluator.js'

export async function evaluateCandidateFiles(fixturePath: string, candidatePath: string) {
  const fixture = await loadLlmEvaluationFixture(fixturePath)
  const candidate: unknown = JSON.parse(await (await import('node:fs/promises')).readFile(candidatePath, 'utf8'))
  return scoreLlmCandidate(fixture, candidate)
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2]
  const candidatePath = process.argv[3]
  if (!fixturePath || !candidatePath) {
    throw new Error('Usage: npx tsx server/evaluation/evaluateLlmCandidate.ts <fixture.json> <candidate.json>')
  }
  const result = await evaluateCandidateFiles(resolve(fixturePath), resolve(candidatePath))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.schema.valid) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Evaluation failed'}\n`)
    process.exitCode = 1
  })
}
