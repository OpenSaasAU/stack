import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BigIntField } from '../../src/components/fields/BigIntField.js'

describe('BigIntField', () => {
  describe('edit mode', () => {
    it('should render text input with label', () => {
      render(<BigIntField name="epoch" value={null} onChange={vi.fn()} label="Epoch" />)

      expect(screen.getByLabelText('Epoch')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display current bigint value as a string', () => {
      render(
        <BigIntField name="epoch" value={9007199254740993n} onChange={vi.fn()} label="Epoch" />,
      )

      expect(screen.getByRole('textbox')).toHaveValue('9007199254740993')
    })

    it('should call onChange with a parsed bigint beyond Number.MAX_SAFE_INTEGER', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<BigIntField name="epoch" value={null} onChange={onChange} label="Epoch" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '9007199254740993')

      expect(onChange).toHaveBeenLastCalledWith(9007199254740993n)
    })

    it('should call onChange with null when input is cleared', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<BigIntField name="epoch" value={123n} onChange={onChange} label="Epoch" />)

      const input = screen.getByRole('textbox')
      await user.clear(input)

      expect(onChange).toHaveBeenLastCalledWith(null)
    })

    it('should handle negative numbers', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<BigIntField name="delta" value={null} onChange={onChange} label="Delta" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '-5')

      expect(onChange).toHaveBeenLastCalledWith(-5n)
    })

    it('should show a warning and stop committing once typed text turns non-numeric', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<BigIntField name="epoch" value={null} onChange={onChange} label="Epoch" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '12')
      expect(onChange).toHaveBeenLastCalledWith(12n)

      await user.type(input, 'abc')

      expect(screen.getByText('Epoch must be an integer')).toBeInTheDocument()
      // The last valid parse stays committed — a partial invalid edit never
      // clobbers it with an unparseable value.
      expect(onChange).toHaveBeenLastCalledWith(12n)
      // The input itself still shows what was actually typed.
      expect(input).toHaveValue('12abc')
    })

    it('should not lose precision while typing a value beyond Number.MAX_SAFE_INTEGER', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<BigIntField name="epoch" value={null} onChange={onChange} label="Epoch" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '9223372036854775807')

      expect(input).toHaveValue('9223372036854775807')
      expect(onChange).toHaveBeenLastCalledWith(9223372036854775807n)
    })

    it('should show required indicator when required', () => {
      render(<BigIntField name="epoch" value={null} onChange={vi.fn()} label="Epoch" required />)

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(<BigIntField name="epoch" value={null} onChange={vi.fn()} label="Epoch" disabled />)

      expect(screen.getByRole('textbox')).toBeDisabled()
    })
  })

  describe('read mode', () => {
    it('should render value as text', () => {
      render(
        <BigIntField
          name="epoch"
          value={9007199254740993n}
          onChange={vi.fn()}
          label="Epoch"
          mode="read"
        />,
      )

      expect(screen.getByText('Epoch')).toBeInTheDocument()
      expect(screen.getByText('9007199254740993')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show dash when value is null', () => {
      render(<BigIntField name="epoch" value={null} onChange={vi.fn()} label="Epoch" mode="read" />)

      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should render a string value passed through as-is', () => {
      render(
        <BigIntField
          name="epoch"
          value="9007199254740993"
          onChange={vi.fn()}
          label="Epoch"
          mode="read"
        />,
      )

      expect(screen.getByText('9007199254740993')).toBeInTheDocument()
    })
  })
})
