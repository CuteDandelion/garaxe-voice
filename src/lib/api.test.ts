import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseAuth', () => ({
  getSupabaseAccessToken: vi.fn(async () => 'local-access-token'),
  signOutSupabase: vi.fn(async () => true),
}))

import { downloadReportPdf } from './api'

afterEach(() => vi.restoreAllMocks())

describe('downloadReportPdf', () => {
  it('authenticates the protected PDF request', async () => {
    const request = vi.fn(async () => new Response('%PDF-local', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:local-report'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadReportPdf('report-id', 'Voice Map Report')

    expect(request).toHaveBeenCalledWith('/api/reports/report-id/pdf', {
      headers: { authorization: 'Bearer local-access-token' },
    })
  })
})
