import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourcesWorkspace } from './SourcesWorkspace'

describe('SourcesWorkspace CSV-only ingestion', () => {
  it('uses the shared CSV preflight without paste, workbook, JSON, or direct connector ingestion', () => {
    render(<SourcesWorkspace projectId="project-1" onImported={vi.fn()} />)
    expect(screen.getByLabelText('Choose CSV file')).toHaveAttribute('accept', '.csv,text/csv')
    expect(screen.getByRole('link', { name: 'Download CSV template' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /paste/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/XLSX|JSON/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect Google/i })).not.toBeInTheDocument()
  })
})
