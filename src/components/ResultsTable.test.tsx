import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsTable } from './ResultsTable'
import type { AnalysisResultRow } from '../shared/analysis'

const row = (rowIndex: number, selectedClass: string): AnalysisResultRow => ({
  rowIndex,
  input: { value: rowIndex },
  model: 'jev',
  selectedClass,
})

describe('ResultsTable', () => {
  it('refreshes earlier visible rows when an existing result changes', () => {
    const rows = [row(0, 'old'), row(1, 'unchanged')]
    const { rerender } = render(<ResultsTable rows={rows} columns={['value']} />)
    expect(screen.getByText('old')).toBeInTheDocument()

    rerender(<ResultsTable rows={[row(0, 'updated'), rows[1]!]} columns={['value']} />)
    expect(screen.getByText('updated')).toBeInTheDocument()
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })
})
