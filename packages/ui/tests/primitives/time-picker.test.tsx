import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimePicker } from '../../src/primitives/time-picker.js'

const at = (h: number, m: number) => new Date(2026, 0, 15, h, m)

describe('TimePicker', () => {
  it('shows the value padded to two digits', () => {
    render(<TimePicker value={at(7, 5)} />)

    expect(screen.getByLabelText('Hours')).toHaveValue(7)
    expect(screen.getByLabelText('Minutes')).toHaveValue(5)
    expect(screen.getByLabelText('Hours').getAttribute('value')).toBe('07')
    expect(screen.getByLabelText('Minutes').getAttribute('value')).toBe('05')
  })

  it('defaults to 12:30 with no value', () => {
    render(<TimePicker />)

    expect(screen.getByLabelText('Hours')).toHaveValue(12)
    expect(screen.getByLabelText('Minutes')).toHaveValue(30)
  })

  it('changes the hour and keeps the date and minutes', () => {
    const onChange = vi.fn()
    render(<TimePicker value={at(7, 5)} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '18' } })

    const next: Date = onChange.mock.calls[0][0]
    expect(next.getHours()).toBe(18)
    expect(next.getMinutes()).toBe(5)
    expect(next.getDate()).toBe(15)
  })

  it('changes the minutes and keeps the hour', () => {
    const onChange = vi.fn()
    render(<TimePicker value={at(7, 5)} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '45' } })

    const next: Date = onChange.mock.calls[0][0]
    expect(next.getHours()).toBe(7)
    expect(next.getMinutes()).toBe(45)
  })

  it.each([
    ['Hours', '99', 23, (d: Date) => d.getHours()],
    ['Hours', '-4', 0, (d: Date) => d.getHours()],
    ['Hours', '', 0, (d: Date) => d.getHours()],
    ['Minutes', '75', 59, (d: Date) => d.getMinutes()],
    ['Minutes', '-1', 0, (d: Date) => d.getMinutes()],
  ])('clamps %s input %j to %i', (label, input, expected, read) => {
    const onChange = vi.fn()
    render(<TimePicker value={at(7, 5)} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText(label), { target: { value: input } })

    expect(read(onChange.mock.calls[0][0])).toBe(expected)
  })

  it('does not mutate the value it was given', () => {
    const value = at(7, 5)
    render(<TimePicker value={value} onChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '18' } })

    expect(value.getHours()).toBe(7)
  })

  it('builds from now when there is no value', () => {
    const onChange = vi.fn()
    render(<TimePicker onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '9' } })

    const next: Date = onChange.mock.calls[0][0]
    expect(next.getHours()).toBe(9)
    expect(next.toDateString()).toBe(new Date().toDateString())
  })

  it('disables both inputs', () => {
    render(<TimePicker value={at(7, 5)} disabled />)

    expect(screen.getByLabelText('Hours')).toBeDisabled()
    expect(screen.getByLabelText('Minutes')).toBeDisabled()
  })
})
