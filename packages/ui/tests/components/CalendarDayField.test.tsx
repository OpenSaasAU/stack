import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarDayField } from '../../src/components/fields/CalendarDayField.js'
import { CalendarDayCell } from '../../src/components/cells/CalendarDayCell.js'
import { getFieldComponent } from '../../src/components/fields/registry.js'
import { getCellComponent } from '../../src/components/cells/registry.js'
import { parseCalendarDay, toCalendarDay } from '../../src/lib/calendarDay.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const calendarDayField: SerializableFieldConfig = { type: 'calendarDay' }

describe('calendarDay registration', () => {
  it('registers a form component for the core field type', () => {
    expect(getFieldComponent('calendarDay')).toBe(CalendarDayField)
  })

  it('registers a cell component for the core field type', () => {
    expect(getCellComponent('calendarDay')).toBe(CalendarDayCell)
  })
})

describe('calendarDay conversions', () => {
  it('parses YYYY-MM-DD to the same day in local time', () => {
    const date = parseCalendarDay('2026-09-11')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(8)
    expect(date?.getDate()).toBe(11)
  })

  it.each(['2026-01-01', '2026-09-11', '2026-12-31'])('round-trips %s unshifted', (day) => {
    const date = parseCalendarDay(day)
    expect(date).not.toBeNull()
    expect(date && toCalendarDay(date)).toBe(day)
  })

  it('returns null for absent or malformed values', () => {
    expect(parseCalendarDay(null)).toBeNull()
    expect(parseCalendarDay('')).toBeNull()
    expect(parseCalendarDay('11/09/2026')).toBeNull()
    // Well-formed but non-existent — must not roll forward into March.
    expect(parseCalendarDay('2026-02-31')).toBeNull()
  })
})

describe('CalendarDayField', () => {
  it('renders the stored day in the trigger', () => {
    render(
      <CalendarDayField
        name="publishDate"
        value="2026-09-11"
        onChange={vi.fn()}
        label="Publish Date"
      />,
    )

    expect(screen.getByRole('button', { name: /11\/09\/2026/ })).toBeInTheDocument()
  })

  it('shows the placeholder when there is no value', () => {
    render(
      <CalendarDayField name="publishDate" value={null} onChange={vi.fn()} label="Publish Date" />,
    )

    expect(screen.getByRole('button', { name: /Pick a date/ })).toBeInTheDocument()
  })

  it('calls onChange with a YYYY-MM-DD string when a day is picked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <CalendarDayField
        name="publishDate"
        value="2026-09-11"
        onChange={onChange}
        label="Publish Date"
      />,
    )

    await user.click(screen.getByRole('button', { name: /11\/09\/2026/ }))
    await user.click(screen.getByRole('button', { name: '15' }))

    expect(onChange).toHaveBeenCalledWith('2026-09-15')
  })

  it('calls onChange with null when cleared', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <CalendarDayField
        name="publishDate"
        value="2026-09-11"
        onChange={onChange}
        label="Publish Date"
      />,
    )

    await user.click(screen.getByRole('button', { name: /11\/09\/2026/ }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders a date without a time in read mode', () => {
    render(
      <CalendarDayField
        name="publishDate"
        value="2026-09-11"
        onChange={vi.fn()}
        label="Publish Date"
        mode="read"
      />,
    )

    expect(screen.getByText('Sep 11, 2026')).toBeInTheDocument()
  })
})

describe('CalendarDayCell', () => {
  it('renders the stored day', () => {
    render(<CalendarDayCell value="2026-09-11" field={calendarDayField} fieldName="publishDate" />)

    const cell = screen.getByText(new Date(2026, 8, 11).toLocaleDateString())
    expect(cell).toHaveAttribute('data-slot', 'cell-calendar-day')
  })

  it('renders a dash for an empty value', () => {
    render(<CalendarDayCell value={null} field={calendarDayField} fieldName="publishDate" />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
