import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateTimePicker } from '../../src/primitives/datetime-picker.js'

const value = new Date(2026, 5, 10, 14, 30)

async function open(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('dialog', { name: /choose date and time/i })
}

describe('DateTimePicker', () => {
  it('shows the placeholder with no value', () => {
    render(<DateTimePicker placeholder="When?" />)

    expect(screen.getByRole('button', { name: 'When?' })).toBeInTheDocument()
  })

  it('names the trigger from its label and shown value', () => {
    render(
      <>
        <span id="at-label">Published</span>
        <DateTimePicker id="at" labelId="at-label" value={value} />
      </>,
    )

    expect(screen.getByRole('button', { name: /^Published 10\/06\/2026/ })).toBeInTheDocument()
  })

  it('names the popover after its label', async () => {
    render(<DateTimePicker label="Published" value={value} />)

    expect(await open(/10\/06\/2026/)).toHaveAccessibleName('Published: choose date and time')
  })

  it('sends the picked day with the existing time on Confirm', async () => {
    const onChange = vi.fn()
    render(<DateTimePicker value={value} onChange={onChange} />)

    await open(/10\/06\/2026/)
    await userEvent.click(screen.getByRole('button', { name: /June 20th, 2026/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    const picked: Date = onChange.mock.calls[0][0]
    expect(picked.getDate()).toBe(20)
    expect(picked.getHours()).toBe(14)
    expect(picked.getMinutes()).toBe(30)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('sends the edited time on Confirm', async () => {
    const onChange = vi.fn()
    render(<DateTimePicker value={value} onChange={onChange} />)

    await open(/10\/06\/2026/)
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '9' } })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    const picked: Date = onChange.mock.calls[0][0]
    expect(picked.getDate()).toBe(10)
    expect(picked.getHours()).toBe(9)
  })

  it('discards the draft on Cancel', async () => {
    const onChange = vi.fn()
    render(<DateTimePicker value={value} onChange={onChange} />)

    await open(/10\/06\/2026/)
    await userEvent.click(screen.getByRole('button', { name: /June 20th, 2026/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await open(/10\/06\/2026/)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual(value)
  })

  it('sends null on Clear', async () => {
    const onChange = vi.fn()
    render(<DateTimePicker value={value} onChange={onChange} />)

    await open(/10\/06\/2026/)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('sends null when confirmed with nothing picked', async () => {
    const onChange = vi.fn()
    render(<DateTimePicker onChange={onChange} />)

    await open(/Pick a date and time/)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('cannot be opened while disabled', () => {
    render(<DateTimePicker value={value} disabled />)

    expect(screen.getByRole('button', { name: /10\/06\/2026/ })).toBeDisabled()
  })
})
