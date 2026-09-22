import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DatasetPreviewCard } from './DatasetPreview'
import type { DatasetPreview } from '../shared/dataset'

const preview = (overrides: Partial<DatasetPreview> = {}): DatasetPreview => ({
  datasetId: 'dataset-1',
  sourceType: 'upload',
  displayName: 'wide.csv',
  byteSize: 32,
  contentHash: 'abc',
  encoding: 'utf-8',
  delimiter: ',',
  columns: [
    { name: 'play_id', normalizedName: 'play_id', inferredType: 'number' },
    { name: 'qtr', normalizedName: 'qtr', inferredType: 'number' },
    { name: 'posteam', normalizedName: 'posteam', inferredType: 'string' },
    { name: 'defteam', normalizedName: 'defteam', inferredType: 'string' },
    { name: 'wpa', normalizedName: 'wpa', inferredType: 'number' },
    { name: 'epa', normalizedName: 'epa', inferredType: 'number' },
    { name: 'fumble', normalizedName: 'fumble', inferredType: 'number' },
  ],
  acceptedRowCount: 71,
  previewRows: Array.from({ length: 71 }, (_, index) => ({
    play_id: index + 1,
    qtr: 1,
    posteam: 'SEA',
    defteam: 'NE',
    wpa: 0.1,
    epa: 0.2,
    fumble: 0,
  })),
  validationWarnings: [],
  publicDataWarning: 'public',
  ...overrides,
})

describe('DatasetPreviewCard', () => {
  it('renders every column and every accepted row in a scroll box', () => {
    const dataset = preview()
    render(<DatasetPreviewCard dataset={dataset} />)
    const table = screen.getByRole('table', { name: /dataset preview/i })
    const headers = within(table).getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual(dataset.columns.map((column) => column.name))
    expect(headers).toContain('fumble')
    expect(headers.length).toBe(7)
    expect(within(table).getAllByRole('row')).toHaveLength(1 + dataset.acceptedRowCount)
    expect(screen.getByText(/^7 columns$/)).toBeInTheDocument()
    expect(screen.queryByText(/showing first/i)).not.toBeInTheDocument()
    expect(document.querySelector('.preview-table')).toBeTruthy()
    expect(document.querySelector('.preview-fold')).toBeTruthy()
    expect((document.querySelector('.preview-fold') as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByText(/preview table/i)).toBeInTheDocument()
    expect(document.querySelector('.dataset-preview.is-secondary')).toBeTruthy()
    expect(table.querySelectorAll('th.is-sticky, td.is-sticky').length).toBe(1 + dataset.acceptedRowCount)
  })

  it('windows a large BYOD table instead of mounting every cell', () => {
    const columns = Array.from({ length: 40 }, (_, index) => ({
      name: `col_${index}`,
      normalizedName: `col_${index}`,
      inferredType: 'string' as const,
    }))
    const dataset = preview({
      acceptedRowCount: 200,
      columns,
      previewRows: Array.from({ length: 200 }, (_, rowIndex) => (
        Object.fromEntries(columns.map((column, columnIndex) => [column.name, `${rowIndex}:${columnIndex}`]))
      )),
    })
    render(<DatasetPreviewCard dataset={dataset} />)
    const table = screen.getByRole('table', { name: /dataset preview/i })
    expect(table).toHaveAttribute('aria-rowcount', '201')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(40)
    expect(within(table).getAllByRole('row').length).toBeLessThan(80)
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1)
    expect(screen.queryByText(/showing first/i)).not.toBeInTheDocument()
    expect(screen.getByText('200 rows')).toBeInTheDocument()
    expect(document.querySelector('.preview-table.is-virtualized')).toBeTruthy()
  })
})
