import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntegerField } from '../../src/components/fields/IntegerField.js'

describe('IntegerField', () => {
  describe('edit mode', () => {
    it('should render number input with label', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" />)

      expect(screen.getByLabelText('Age')).toBeInTheDocument()
      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    })

    it('should display current numeric value', () => {
      render(<IntegerField name="age" value={25} onChange={vi.fn()} label="Age" />)

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(25)
    })

    it('should display empty string for null value', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" />)

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(null)
    })

    it('should call onChange with parsed integer', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<IntegerField name="age" value={null} onChange={onChange} label="Age" />)

      const input = screen.getByRole('spinbutton')
      await user.type(input, '5')

      expect(onChange).toHaveBeenCalled()
      // Verify it's called with a number, not a string
      expect(onChange).toHaveBeenCalledWith(5)
    })

    it('should call onChange with null when input is cleared', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<IntegerField name="age" value={25} onChange={onChange} label="Age" />)

      const input = screen.getByRole('spinbutton')
      await user.clear(input)

      expect(onChange).toHaveBeenCalledWith(null)
    })

    it('should show required indicator when required', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" required />)

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should display error message', () => {
      render(
        <IntegerField
          name="age"
          value={null}
          onChange={vi.fn()}
          label="Age"
          error="Age must be a positive number"
        />,
      )

      expect(screen.getByText('Age must be a positive number')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" disabled />)

      const input = screen.getByRole('spinbutton')
      expect(input).toBeDisabled()
    })

    it('should show placeholder text', () => {
      render(
        <IntegerField
          name="age"
          value={null}
          onChange={vi.fn()}
          label="Age"
          placeholder="Enter your age"
        />,
      )

      expect(screen.getByPlaceholderText('Enter your age')).toBeInTheDocument()
    })

    it('should set min attribute', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" min={0} />)

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveAttribute('min', '0')
    })

    it('should set max attribute', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" max={100} />)

      const input = screen.getByRole('spinbutton')
      expect(input).toHaveAttribute('max', '100')
    })

    it('should handle negative numbers', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(
        <IntegerField name="temperature" value={null} onChange={onChange} label="Temperature" />,
      )

      const input = screen.getByRole('spinbutton')
      await user.type(input, '-5')

      expect(onChange).toHaveBeenCalledWith(-5)
    })
  })

  describe('read mode', () => {
    it('should render value as text', () => {
      render(<IntegerField name="age" value={25} onChange={vi.fn()} label="Age" mode="read" />)

      expect(screen.getByText('Age')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    })

    it('should show dash when value is null', () => {
      render(<IntegerField name="age" value={null} onChange={vi.fn()} label="Age" mode="read" />)

      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should display zero correctly', () => {
      render(<IntegerField name="count" value={0} onChange={vi.fn()} label="Count" mode="read" />)

      expect(screen.getByText('0')).toBeInTheDocument()
      expect(screen.queryByText('-')).not.toBeInTheDocument()
    })
  })
})
