import { isAbsolute, relative, resolve } from 'node:path'

const TEMP_PREFIX = '/private/tmp/voice-lab-continuous-50x50.'
const PROJECT_PREFIX = 'voice-lab-continuous-50x50-'

function assertLoopback(rawUrl: string, label: string) {
  const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '')
  if (hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error(`${label} URL must use an explicit loopback address`)
  }
}

export function validateHarnessScope(input: {
  tempRoot: string
  projectId: string
  supabaseUrl: string
  databaseUrl: string
  existingProjectIds?: string[]
}) {
  if (!isAbsolute(input.tempRoot) || !resolve(input.tempRoot).startsWith(TEMP_PREFIX)) {
    throw new Error('Harness root must be a unique /private/tmp scope')
  }
  if (!input.projectId.startsWith(PROJECT_PREFIX)
    || input.existingProjectIds?.includes(input.projectId)) {
    throw new Error('Harness project ID must be unique')
  }
  assertLoopback(input.supabaseUrl, 'Supabase')
  assertLoopback(input.databaseUrl, 'Database')
  return { tempRoot: input.tempRoot, projectId: input.projectId }
}

export function assertAppendProject(baselineProjectId: string, appendProjectId: string) {
  if (baselineProjectId !== appendProjectId) {
    throw new Error('Append must target the baseline project')
  }
  return appendProjectId
}

export function assertCleanupTarget(input: {
  tempRoot: string
  target: string
  projectId: string
  cleanupProjectId: string
}) {
  const relativeTarget = relative(resolve(input.tempRoot), resolve(input.target))
  if (input.projectId !== input.cleanupProjectId
    || !relativeTarget
    || relativeTarget.startsWith('..')
    || isAbsolute(relativeTarget)) {
    throw new Error('Unsafe cleanup target')
  }
  return input.target
}
