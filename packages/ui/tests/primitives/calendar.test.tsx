import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Calendar } from '../../src/primitives/calendar.js'
import { CalendarDayField } from '../../src/components/fields/CalendarDayField.js'
import { TimestampField } from '../../src/components/fields/TimestampField.js'

const HEADER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const DAY_MS = 86_400_000
const ZONES = ['UTC', 'Australia/Melbourne', 'America/New_York', 'America/Havana']

const utcLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function runInZone(zone: string) {
  const original = process.env.TZ

  beforeEach(() => {
    process.env.TZ = zone
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
  })

  afterEach(() => {
    process.env.TZ = original
  })
}

// Computed in UTC, away from both date-fns and the zone under test.
function expectedGrid(year: number, month: number): string[][] {
  const first = Date.UTC(year, month, 1)
  const last = Date.UTC(year, month + 1, 0)
  const leading = (new Date(first).getUTCDay() + 6) % 7
  const trailing = (7 - new Date(last).getUTCDay()) % 7
  const cells: string[] = []
  for (let at = first - leading * DAY_MS; at <= last + trailing * DAY_MS; at += DAY_MS) {
    cells.push(utcLabel.format(at))
  }
  const rows: string[][] = []
  for (let start = 0; start < cells.length; start += 7) {
    rows.push(cells.slice(start, start + 7))
  }
  return rows
}

function headerLabels(): string[] {
  return screen.getAllByRole('columnheader').map((header) => header.textContent ?? '')
}

function gridRows(): HTMLElement[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button'))
}

function renderedGrid(): string[][] {
  return gridRows().map((row) =>
    row.map((cell) => (cell.getAttribute('aria-label') ?? '').replace(/(\d)(st|nd|rd|th)/, '$1')),
  )
}

function columnOf(name: RegExp): string {
  const cell = screen.getByRole('button', { name })
  const row = gridRows().find((candidate) => candidate.includes(cell))
  return headerLabels()[row?.indexOf(cell) ?? -1] ?? 'not in the grid'
}

function cellUnder(column: string, dayOfMonth: string): HTMLElement {
  const index = headerLabels().indexOf(column)
  const matches = gridRows()
    .map((row) => row[index])
    .filter((cell) => cell?.textContent === dayOfMonth && !cell.classList.contains('opacity-50'))
  const [cell] = matches
  if (matches.length !== 1 || cell === undefined) {
    throw new Error(`Expected one ${dayOfMonth} under ${column}, found ${matches.length}`)
  }
  return cell
}

describe('Calendar week layout', () => {
  it('derives a Monday-first header', () => {
    render(<Calendar selected={new Date(2026, 5, 15)} />)

    expect(headerLabels()).toEqual(HEADER)
  })

  it.each([
    ['Monday', 2026, 5, 'Mo'],
    ['Tuesday', 2026, 8, 'Tu'],
    ['Wednesday', 2026, 3, 'We'],
    ['Thursday', 2026, 0, 'Th'],
    ['Friday', 2026, 4, 'Fr'],
    ['Saturday', 2026, 7, 'Sa'],
    ['Sunday', 2026, 2, 'Su'],
  ])('puts the first of a month starting on %s under its weekday', (weekday, year, month, col) => {
    render(<Calendar selected={new Date(year, month, 15)} />)

    expect(columnOf(new RegExp(`^${weekday}, .* 1st, ${year}$`))).toBe(col)
    expect(renderedGrid()).toEqual(expectedGrid(year, month))
  })

  it('fits a February starting on a Monday in exactly four rows', () => {
    render(<Calendar selected={new Date(2027, 1, 15)} />)

    expect(renderedGrid()).toEqual(expectedGrid(2027, 1))
    expect(gridRows()).toHaveLength(4)
  })

  it('shows the 29th of a leap February under its weekday', () => {
    render(<Calendar selected={new Date(2028, 1, 15)} />)

    expect(columnOf(/February 29th, 2028/)).toBe('Tu')
    expect(renderedGrid()).toEqual(expectedGrid(2028, 1))
  })

  it('adds no row of next month after a month ending on a Sunday', () => {
    render(<Calendar selected={new Date(2026, 4, 15)} />)

    expect(columnOf(/May 31st, 2026/)).toBe('Su')
    expect(gridRows().at(-1)?.at(-1)).toHaveAccessibleName(/May 31st, 2026/)
  })

  it('fills the first row from the month before and the last from the month after', () => {
    render(<Calendar selected={new Date(2026, 8, 15)} />)

    expect(gridRows()[0]?.[0]).toHaveAccessibleName(/August 31st, 2026/)
    expect(gridRows().at(-1)?.at(-1)).toHaveAccessibleName(/October 4th, 2026/)
  })

  it('stays aligned when paging across a year boundary', async () => {
    const user = userEvent.setup()
    render(<Calendar selected={new Date(2026, 11, 15)} />)

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(renderedGrid()).toEqual(expectedGrid(2027, 0))

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(renderedGrid()).toEqual(expectedGrid(2026, 10))
  })
})

describe.each(ZONES)('Calendar in %s', (zone) => {
  runInZone(zone)

  it.each([
    [2026, 2],
    [2026, 3],
    [2026, 8],
    [2026, 9],
    [2026, 10],
  ])('lays out year %i month index %i on the true weekdays', (year, month) => {
    render(<Calendar selected={new Date(year, month, 15)} />)

    expect(renderedGrid()).toEqual(expectedGrid(year, month))
  })

  it('hands back the local day of the cell that was clicked', async () => {
    const onSelect = vi.fn<(date: Date) => void>()
    const user = userEvent.setup()
    render(<Calendar selected={new Date(2026, 2, 15)} onSelect={onSelect} />)

    await user.click(cellUnder('Su', '8'))

    const picked = onSelect.mock.calls[0]?.[0]
    expect(picked?.getFullYear()).toBe(2026)
    expect(picked?.getMonth()).toBe(2)
    expect(picked?.getDate()).toBe(8)
    expect(picked?.getDay()).toBe(0)
  })

  it('marks the selected day on its own cell', () => {
    render(<Calendar selected={new Date(2026, 5, 15, 23, 30)} />)

    const pressed = gridRows()
      .flat()
      .filter((cell) => cell.getAttribute('aria-pressed') === 'true')

    expect(pressed).toEqual([cellUnder('Mo', '15')])
  })

  describe('with today fixed', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 5, 15, 12) })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('marks today on its own cell', () => {
      render(<Calendar />)

      const current = gridRows()
        .flat()
        .filter((cell) => cell.getAttribute('aria-current') === 'date')

      expect(current).toEqual([cellUnder('Mo', '15')])
    })

    it('stores the Monday picked from the Mo column of a calendarDay() field', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CalendarDayField name="due" value={null} onChange={onChange} label="Due" />)

      await user.click(screen.getByRole('button', { name: /Pick a date/ }))
      await user.click(cellUnder('Mo', '15'))

      expect(onChange).toHaveBeenCalledWith('2026-06-15')
    })

    it('stores the Monday picked from the Mo column of a timestamp() field', async () => {
      const onChange = vi.fn<(value: Date | null) => void>()
      const user = userEvent.setup()
      render(
        <TimestampField
          name="at"
          value={new Date(2026, 5, 10, 14, 30)}
          onChange={onChange}
          label="At"
        />,
      )

      await user.click(screen.getByRole('button', { name: /10\/06\/2026/ }))
      await user.click(cellUnder('Mo', '15'))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      const picked = onChange.mock.calls[0]?.[0]
      expect(picked?.getDay()).toBe(1)
      expect(picked?.getDate()).toBe(15)
      expect(picked?.getHours()).toBe(14)
      expect(picked?.getMinutes()).toBe(30)
    })
  })
})
