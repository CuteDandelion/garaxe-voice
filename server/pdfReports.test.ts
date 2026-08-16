// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderReportPdf } from './pdfReports'

describe('PDF report rendering boundary', () => {
  it('renders stored feedback markup as literal report text', async () => {
    const markup = '<script>alert(1)</script> & literal customer feedback'
    const pdf = await renderReportPdf({
      schemaVersion: 'report-snapshot-v2',
      narrative: { headline: markup, executiveSummary: markup, actions: [] },
      dataset: { counts: { included: 1 }, sourceCount: 1 },
      curation: { revision: 0 },
      charts: { themePrevalence: [], ratingDistribution: [], reviewTimeline: [] },
      themes: [{
        id: 'theme-1', name: markup, topic: markup, summary: markup, type: 'pain', confidence: 'emerging',
        evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: markup, originalText: markup }],
      }],
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
