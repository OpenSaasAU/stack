import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VirtualField } from '../../src/components/fields/VirtualField.js'

describe('VirtualField', () => {
  it('renders the resolved value read-only with the label', () => {
    render(
      <VirtualField name="fullName" value="Ada Lovelace" onChange={vi.fn()} label="Full Name" />,
    )

    expect(screen.getByText('Full Name')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('renders no editable control', () => {
    render(
      <VirtualField name="fullName" value="Ada Lovelace" onChange={vi.fn()} label="Full Name" />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders the empty-value affordance for null/undefined rather than the string "null"', () => {
    const { rerender } = render(
      <VirtualField name="fullName" value={null} onChange={vi.fn()} label="Full Name" />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()
    expect(screen.queryByText('null')).not.toBeInTheDocument()

    rerender(
      <VirtualField name="fullName" value={undefined} onChange={vi.fn()} label="Full Name" />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders a non-string value as readable text rather than [object Object]', () => {
    render(
      <VirtualField
        name="total"
        value={{ amount: '19.99', currency: 'USD' }}
        onChange={vi.fn()}
        label="Total"
      />,
    )

    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('{"amount":"19.99","currency":"USD"}')).toBeInTheDocument()
  })

  it('renders a numeric value as text', () => {
    render(<VirtualField name="count" value={42} onChange={vi.fn()} label="Count" />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
