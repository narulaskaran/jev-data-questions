import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_STORY_COPY, NO_QUESTION_MATCH_COPY, StoryDashboard, viewCsv, viewCsvFilename } from './StoryDashboard'
import { ChartView } from './charts'
import { buildStoryDashboard } from '../../insights/dashboard'
import type { RowNoun } from '../../insights/views'

type Row = Record<string, string | number | boolean | null>

const noun: RowNoun = { singular: 'order', plural: 'orders' }

const rows: Row[] = Array.from({ length: 120 }, (_, index) => ({
  order_date: `2025-${String(Math.floor(index / 10) + 1).padStart(2, '0')}-${String((index % 10) * 2 + 1).padStart(2, '0')}`,
  region: ['West', 'East', 'North'][index % 3]!,
  units: 5 + Math.floor(index / 10) * 2 + (index % 3 === 0 ? 9 : 0) + (index % 4),
  gift: index % 3 === 0 ? index % 2 === 0 : index % 10 === 0,
}))

const Harness = ({ data = rows, onShare }: { data?: Row[]; onShare?: () => void }) => {
  const [question, setQuestion] = useState('')
  const dashboard = buildStoryDashboard(Object.keys(data[0] ?? { a: 1 }), data, { noun, question })
  return <StoryDashboard dashboard={dashboard} question={question} onAsk={setQuestion} onShare={onShare} />
}

describe('StoryDashboard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders headline figures and one card per finding, each stating it in a heading', () => {
    render(<Harness />)
    const figures = screen.getByLabelText('Key figures')
    expect(within(figures).getByText('Orders')).toBeInTheDocument()
    expect(within(figures).getByText('120')).toBeInTheDocument()
    expect(within(figures).getByText('Total units')).toBeInTheDocument()

    const cards = [...document.querySelectorAll<HTMLElement>('.story-card')]
    expect(cards.length).toBeGreaterThanOrEqual(3)
    expect(cards[0]).toHaveAttribute('data-view-kind', 'trend')
    expect(cards[0]).toHaveAttribute('data-wide')
    for (const card of cards) {
      const heading = within(card).getByRole('heading', { level: 2 })
      expect(card).toHaveAttribute('aria-labelledby', heading.id)
      expect(card.querySelector('.story-subtitle')?.textContent).toBeTruthy()
    }
    expect(screen.getByRole('heading', { name: /^West leads units with [\d,]+, \d+% of the total$/ })).toBeInTheDocument()
    // Charts are named for assistive technology by what they show.
    expect(screen.getAllByRole('img', { name: /Total units/ }).length).toBeGreaterThan(0)
  })

  it('draws bars with one value label each and no rank-coloured rainbow', () => {
    render(<Harness />)
    const card = screen.getByRole('heading', { name: /leads units with/ }).closest('.story-card') as HTMLElement
    const bars = within(card).getAllByRole('listitem')
    expect(bars.map((bar) => bar.querySelector('.story-bar-label')?.textContent)).toEqual(['West', 'North', 'East'])
    expect(bars.every((bar) => /^[\d,.K]+$/.test(bar.querySelector('.story-bar-value')?.textContent ?? ''))).toBe(true)
    // The longest bar fills the track; none is individually coloured.
    expect((bars[0]!.querySelector('.story-bar-fill') as HTMLElement).style.getPropertyValue('--bar')).toBe('100%')
    expect(bars.every((bar) => !(bar.querySelector('.story-bar-fill') as HTMLElement).style.background)).toBe(true)
  })

  it('swaps a chart for its data table and exports the same rows as CSV', () => {
    const urls = { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() }
    Object.assign(URL, urls)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<Harness />)
    const card = screen.getByRole('heading', { name: /leads units with/ }).closest('.story-card') as HTMLElement
    const toggle = within(card).getByRole('button', { name: /show data table for/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    const table = within(card).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Region', 'Total units', 'Orders'])
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(card.querySelector('.story-bars')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /show chart for/i }))
    expect(card.querySelector('.story-bars')).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: /download csv for/i }))
    expect(click).toHaveBeenCalledOnce()
    const view = buildStoryDashboard(Object.keys(rows[0]!), rows, { noun }).views.find((item) => item.id === 'ranking:region+units')!
    expect(viewCsvFilename(view)).toBe('jev-ranking-region-units.csv')
    expect(viewCsv(view).split('\n')[0]).toBe('Region,Total units,Orders')
    expect(viewCsv(view).split('\n')).toHaveLength(5)
  })

  it('escapes formula-like cells in exported CSV', () => {
    const risky: Row[] = Array.from({ length: 12 }, (_, index) => ({ team: index % 2 === 0 ? '=SUM(A1)' : 'Blue', points: index + 1 }))
    const view = buildStoryDashboard(['team', 'points'], risky).views.find((item) => item.fields.includes('team'))!
    expect(viewCsv(view)).toContain("'=SUM(A1)")
  })

  it('reorders the dashboard around a question and can clear it', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Ask about your columns')
    expect(input).toHaveAttribute('placeholder', 'For example: units by region')
    fireEvent.change(input, { target: { value: 'gift by region' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('status')).toHaveTextContent('Leading with charts about: Region, Gift.')
    expect(document.querySelector('.story-card')).toHaveAttribute('data-view-kind', 'rate')
    expect(document.querySelector('.story-card h2')?.textContent).toMatch(/^Gift is most common for West/)

    fireEvent.change(input, { target: { value: 'weather on mars' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('status')).toHaveTextContent(NO_QUESTION_MATCH_COPY)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(document.querySelector('.story-card')).toHaveAttribute('data-view-kind', 'trend')
    expect(input).toHaveValue('')
  })

  it('offers sharing only when a link exists, and says so when there is nothing to chart', () => {
    const onShare = vi.fn()
    const shared = render(<Harness onShare={onShare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy a link to this dashboard' }))
    expect(onShare).toHaveBeenCalledOnce()
    shared.unmount()
    const local = render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Copy a link to this dashboard' })).not.toBeInTheDocument()
    local.unmount()
    render(<Harness data={[{ note: 'first' }, { note: 'second' }]} />)
    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_STORY_COPY)
    expect(document.querySelector('.story-card')).toBeNull()
  })
})

describe('chart rendering', () => {
  const dashboard = (data: Row[]) => buildStoryDashboard(Object.keys(data[0]!), data, { noun })

  it('draws a line with round axis values, a labelled point, and a hover readout', () => {
    const trend = dashboard(rows).views.find((item) => item.kind === 'trend')!
    render(<ChartView chart={trend.chart} label="Units over time" />)
    const svg = screen.getByRole('img', { name: 'Units over time' })
    expect(svg.querySelector('path.story-line')?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+){10}$/)
    expect(svg.querySelector('path.story-area')).toBeTruthy()
    const ticks = [...svg.querySelectorAll('text.story-tick')].map((node) => node.textContent)
    // December is only partly covered by the data, so the axis ends at November.
    expect(ticks).toEqual(expect.arrayContaining(['0', 'Jan 2025', 'Nov 2025']))
    expect(ticks).not.toContain('Dec 2025')
    expect(svg.querySelectorAll('text.story-direct-label')).toHaveLength(1)
    expect(document.querySelector('.story-tooltip')).toBeNull()
    fireEvent.pointerMove(svg, { clientX: 100 })
    expect(document.querySelector('.story-tooltip')?.textContent).toMatch(/2025/)
    fireEvent.pointerLeave(svg)
    expect(document.querySelector('.story-tooltip')).toBeNull()
  })

  it('draws a map with one dot per located row, beside a ranking of places', () => {
    const places: Row[] = Array.from({ length: 60 }, (_, index) => ({
      latitude: 40.7 + (index % 10) / 200,
      longitude: -74 + Math.floor(index / 10) / 150,
      district: index < 30 ? 'Harbor' : ['Hill', 'Market', 'Old Town'][index % 3]!,
    }))
    const map = dashboard(places).views[0]!
    render(<ChartView chart={map.chart} label="Where orders are" />)
    expect(screen.getByRole('img', { name: 'Where orders are' }).querySelectorAll('circle.story-dot')).toHaveLength(60)
    expect(screen.getByText('Most orders by district')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Harbor30')
  })

  it('draws a spread with its median and a relationship with its fitted line', () => {
    const data: Row[] = Array.from({ length: 80 }, (_, index) => ({ distance: 1 + (index % 20) / 2, fare: 4 + (1 + (index % 20) / 2) * 2 + ((index * 13) % 7) }))
    const views = dashboard(data).views
    const histogram = views.find((item) => item.kind === 'histogram')!
    const scatter = views.find((item) => item.kind === 'scatter')!
    const first = render(<ChartView chart={histogram.chart} label="Spread" />)
    expect(screen.getByRole('img', { name: 'Spread' }).querySelectorAll('path.story-column').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText(/^Median /)).toBeInTheDocument()
    first.unmount()
    render(<ChartView chart={scatter.chart} label="Relationship" />)
    const svg = screen.getByRole('img', { name: 'Relationship' })
    expect(svg.querySelectorAll('circle.story-dot')).toHaveLength(80)
    expect(svg.querySelector('line.story-reference')).toBeTruthy()
    expect([...svg.querySelectorAll('text.story-axis-title')].map((node) => node.textContent)).toEqual(['Fare', 'Distance'])
  })
})
