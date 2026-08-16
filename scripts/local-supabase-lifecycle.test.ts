import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve('scripts/local-supabase-lifecycle.sh')

describe('local Supabase lifecycle helper', () => {
  it.each(['start', 'status'])("dry-runs %s against only voice-lab-local", (command) => {
    const output = execFileSync(script, [command, '--dry-run'], { encoding: 'utf8' })
    expect(output).toContain('project: voice-lab-local')
    expect(output).toContain('supabase/config.toml')
  })

  it('requires the exact owned project confirmation before destructive stop', () => {
    const missing = spawnSync(script, ['stop', '--dry-run'], { encoding: 'utf8' })
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('--confirm voice-lab-local')

    const wrong = spawnSync(script, ['stop', '--dry-run', '--confirm', 'shared-stack'], {
      encoding: 'utf8',
    })
    expect(wrong.status).not.toBe(0)
    expect(wrong.stderr).toContain('refusing to stop')

    const valid = execFileSync(
      script,
      ['stop', '--dry-run', '--confirm', 'voice-lab-local'],
      { encoding: 'utf8' },
    )
    expect(valid).toContain('supabase stop --workdir')
    expect(valid).toContain('--project-id voice-lab-local --no-backup')
  })
})
