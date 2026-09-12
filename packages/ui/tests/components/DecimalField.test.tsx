import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DecimalField } from '../../src/components/fields/DecimalField.js'

describe('DecimalField', () => {
  describe('edit mode', () => {
    it('should render text input with label', () => {
      render(<DecimalField name="price" value={null} onChange={vi.fn()} label="Price" />)

      expect(screen.getByLabelText('Price')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display the current string value as-is', () => {
      render(<DecimalField name="price" value="19.99" onChange={vi.fn()} label="Price" />)

      expect(screen.getByRole('textbox')).toHaveValue('19.99')
    })

    it('should call onChange with the typed string, never a number', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<DecimalField name="price" value={null} onChange={onChange} label="Price" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '19.99')

      expect(onChange).toHaveBeenLastCalledWith('19.99')
    })

    it('should call onChange with null when input is cleared', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<DecimalField name="price" value="19.99" onChange={onChange} label="Price" />)

      const input = screen.getByRole('textbox')
      await user.clear(input)

      expect(onChange).toHaveBeenLastCalledWith(null)
    })

    it('should handle negative numbers', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<DecimalField name="delta" value={null} onChange={onChange} label="Delta" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '-5.5')

      expect(onChange).toHaveBeenLastCalledWith('-5.5')
    })

    it('should show a warning and stop committing once typed text turns non-numeric', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<DecimalField name="price" value={null} onChange={onChange} label="Price" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '12.5')
      expect(onChange).toHaveBeenLastCalledWith('12.5')

      await user.type(input, 'abc')

      expect(screen.getByText('Price must be a decimal value')).toBeInTheDocument()
      // The last valid value stays committed — a partial invalid edit never
      // clobbers it with an unparseable value.
      expect(onChange).toHaveBeenLastCalledWith('12.5')
      // The input itself still shows what was actually typed.
      expect(input).toHaveValue('12.5abc')
    })

    it('should not lose precision a JS number cannot represent exactly', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<DecimalField name="price" value={null} onChange={onChange} label="Price" />)

      const input = screen.getByRole('textbox')
      await user.type(input, '123456789012345.123456789012345')

      expect(input).toHaveValue('123456789012345.123456789012345')
      expect(onChange).toHaveBeenLastCalledWith('123456789012345.123456789012345')
    })

    it('should show required indicator when required', () => {
      render(<DecimalField name="price" value={null} onChange={vi.fn()} label="Price" required />)

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(<DecimalField name="price" value={null} onChange={vi.fn()} label="Price" disabled />)

      expect(screen.getByRole('textbox')).toBeDisabled()
    })
  })

  describe('read mode', () => {
    it('should render value as text', () => {
      render(
        <DecimalField name="price" value="19.99" onChange={vi.fn()} label="Price" mode="read" />,
      )

      expect(screen.getByText('Price')).toBeInTheDocument()
      expect(screen.getByText('19.99')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show dash when value is null', () => {
      render(
        <DecimalField name="price" value={null} onChange={vi.fn()} label="Price" mode="read" />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should render a high-precision value without rounding', () => {
      render(
        <DecimalField
          name="price"
          value="123456789012345.123456789012345"
          onChange={vi.fn()}
          label="Price"
          mode="read"
        />,
      )

      expect(screen.getByText('123456789012345.123456789012345')).toBeInTheDocument()
    })
  })
})
