import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CsvImportPreflight } from './CsvImportPreflight'

describe('CSV import preflight', () => {
  it('keeps requirements concise and requires explicit mapping before continue', async () => {
    const onContinue = vi.fn()
    render(<CsvImportPreflight onContinue={onContinue} />)

    expect(screen.getByText(/CSV with feedback ID, source, and comment text/i)).toBeInTheDocument()
    expect(screen.getByText(/Ratings and rating scales are optional/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download CSV template' })).toHaveAttribute('download')
    const disclosure = screen.getByText('See required fields').closest('details')
    expect(disclosure).not.toHaveAttribute('open')
    expect(screen.queryByRole('textbox', { name: /paste/i })).not.toBeInTheDocument()

    const file = new File(['id,platform,comment,extra\na-1,Support,Useful feedback,internal'], 'feedback.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('table', { name: 'CSV mapping preview' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Continue with CSV' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/extra.*map or exclude/i)
    fireEvent.change(screen.getByLabelText('Map extra'), { target: { value: 'excluded' } })
    expect(screen.getByRole('button', { name: 'Continue with CSV' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with CSV' }))
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'feedback.csv' }))
  })

  it('rejects non-CSV files before mapping', async () => {
    render(<CsvImportPreflight onContinue={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [new File(['x'], 'feedback.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/CSV files only/i))
    expect(screen.queryByRole('table', { name: 'CSV mapping preview' })).not.toBeInTheDocument()
  })

  it('accepts a larger Demo CSV for server-side quota selection and explains the partial import', async () => {
    render(<CsvImportPreflight onContinue={vi.fn()} maxRows={1} />)
    const file = new File([
      'review_id,source,review_text\na-1,Support,First sufficiently detailed customer comment.\na-2,Support,Second sufficiently detailed customer comment.',
    ], 'feedback.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Choose CSV file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('table', { name: 'CSV mapping preview' })).toBeInTheDocument())
    expect(screen.queryByText(/limited to 1 feedback rows/i)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/first 1 eligible unique record/i)
  })
})
