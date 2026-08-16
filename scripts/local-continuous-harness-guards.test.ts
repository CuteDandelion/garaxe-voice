import { describe, expect, it } from 'vitest'
import {
  assertAppendProject,
  assertCleanupTarget,
  validateHarnessScope,
} from './local-continuous-harness-guards'

const tempRoot = '/private/tmp/voice-lab-continuous-50x50.test123'
const projectId = 'voice-lab-continuous-50x50-test123'

describe('local continuous harness guards', () => {
  it.each([
    'https://example.com',
    'http://localhost.evil.test:54321',
    'http://0.0.0.0:54321',
  ])('rejects Supabase loopback escape %s', (supabaseUrl) => {
    expect(() => validateHarnessScope({
      tempRoot,
      projectId,
      supabaseUrl,
      databaseUrl: 'postgresql://voice_lab_api:test@127.0.0.1:55422/postgres',
    })).toThrow('Supabase URL must use an explicit loopback address')
  })

  it('rejects a non-unique or existing project identity', () => {
    expect(() => validateHarnessScope({
      tempRoot,
      projectId: 'voice-lab-local',
      supabaseUrl: 'http://127.0.0.1:55421',
      databaseUrl: 'postgresql://voice_lab_api:test@127.0.0.1:55422/postgres',
      existingProjectIds: ['voice-lab-local'],
    })).toThrow('Harness project ID must be unique')
  })

  it('rejects an append aimed at another project', () => {
    expect(() => assertAppendProject('project-baseline', 'project-other'))
      .toThrow('Append must target the baseline project')
  })

  it.each([
    ['/private/tmp/other-project', projectId],
    [`${tempRoot}/data`, 'voice-lab-continuous-50x50-other'],
  ])('rejects cleanup outside its owned scope', (target, cleanupProjectId) => {
    expect(() => assertCleanupTarget({ tempRoot, target, projectId, cleanupProjectId }))
      .toThrow('Unsafe cleanup target')
  })

  it('accepts only the owned loopback scope', () => {
    expect(validateHarnessScope({
      tempRoot,
      projectId,
      supabaseUrl: 'http://127.0.0.1:55421',
      databaseUrl: 'postgresql://voice_lab_api:test@[::1]:55422/postgres',
      existingProjectIds: ['voice-lab-local'],
    })).toEqual({ tempRoot, projectId })
    expect(assertAppendProject('project-one', 'project-one')).toBe('project-one')
    expect(assertCleanupTarget({
      tempRoot,
      target: `${tempRoot}/supabase`,
      projectId,
      cleanupProjectId: projectId,
    })).toBe(`${tempRoot}/supabase`)
  })
})
