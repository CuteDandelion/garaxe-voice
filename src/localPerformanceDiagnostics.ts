export function localPerformanceDiagnosticsEnabled(
  environment: { DEV: boolean; VITE_LOCAL_PERFORMANCE_DIAGNOSTICS?: string },
  hostname: string,
) {
  return environment.DEV
    && environment.VITE_LOCAL_PERFORMANCE_DIAGNOSTICS === 'true'
    && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)
}
