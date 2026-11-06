import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'

import { Calendar } from '../../../src/primitives/calendar.js'
import { DatePicker } from '../../../src/primitives/date-picker.js'

afterEach(() => cleanup())

function expectUnderHeader(cell: HTMLElement, label: string) {
  const header = screen.getByRole('columnheader', { name: label }).getBoundingClientRect()
  const { left, width } = cell.getBoundingClientRect()
  const centre = left + width / 2

  expect(centre).toBeGreaterThan(header.left)
  expect(centre).toBeLessThan(header.right)
}

describe('Calendar in a real browser', () => {
  it('draws a Monday directly below the Mo header', () => {
    render(<Calendar selected={new Date(2026, 5, 15)} />)

    expectUnderHeader(screen.getByRole('button', { name: /^Monday, June 15th, 2026$/ }), 'Mo')
    expectUnderHeader(screen.getByRole('button', { name: /^Sunday, June 14th, 2026$/ }), 'Su')
  })

  it('reaches every day by Tab in week order, Monday first', async () => {
    render(<Calendar selected={new Date(2026, 5, 15)} />)

    screen.getByRole('button', { name: 'Next month' }).focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^Monday, June 1st, 2026$/ }),
    )

    await userEvent.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^Tuesday, June 2nd, 2026$/ }),
    )
  })

  it('selects the focused day from the keyboard inside the picker', async () => {
    const onChange = vi.fn<(date: Date | null) => void>()
    render(<DatePicker value={new Date(2026, 5, 10)} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /10\/06\/2026/ }))
    const dialog = await screen.findByRole('dialog')
    within(dialog)
      .getByRole('button', { name: /^Monday, June 15th, 2026$/ })
      .focus()
    await userEvent.keyboard('{Enter}')

    const picked = onChange.mock.calls[0]?.[0]
    expect(picked?.getDay()).toBe(1)
    expect(picked?.getDate()).toBe(15)
  })
})
