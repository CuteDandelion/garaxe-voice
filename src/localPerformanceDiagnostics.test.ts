import { describe, expect, it } from 'vitest'
import { localPerformanceDiagnosticsEnabled } from './localPerformanceDiagnostics'

describe('local performance diagnostics access', () => {
  it('requires the explicit flag, development mode, and a loopback hostname', () => {
    expect(localPerformanceDiagnosticsEnabled({ DEV: true, VITE_LOCAL_PERFORMANCE_DIAGNOSTICS: 'true' }, '127.0.0.1')).toBe(true)
    expect(localPerformanceDiagnosticsEnabled({ DEV: true, VITE_LOCAL_PERFORMANCE_DIAGNOSTICS: 'true' }, 'localhost')).toBe(true)
    expect(localPerformanceDiagnosticsEnabled({ DEV: true, VITE_LOCAL_PERFORMANCE_DIAGNOSTICS: 'false' }, '127.0.0.1')).toBe(false)
    expect(localPerformanceDiagnosticsEnabled({ DEV: false, VITE_LOCAL_PERFORMANCE_DIAGNOSTICS: 'true' }, '127.0.0.1')).toBe(false)
    expect(localPerformanceDiagnosticsEnabled({ DEV: true, VITE_LOCAL_PERFORMANCE_DIAGNOSTICS: 'true' }, 'voicelab.elseform.tech')).toBe(false)
  })
})
