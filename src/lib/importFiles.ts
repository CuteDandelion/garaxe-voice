export { rowsToCsv } from './csv'

async function fileToCsv(file: File) {
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension !== 'csv' || (file.type && !['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.type))) {
    throw new Error('CSV files only. Download the template to see the accepted schema.')
  }
  if (typeof file.text === 'function') return file.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The CSV could not be read.'))
    reader.readAsText(file)
  })
}

export async function prepareImportFile(file: File) {
  const rawCsv = await fileToCsv(file)
  return { rawCsv, originalSource: { encoding: 'utf8' as const, content: rawCsv, mediaType: 'text/csv' } }
}
