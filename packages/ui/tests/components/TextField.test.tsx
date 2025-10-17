import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField } from '../../src/components/fields/TextField.js'

describe('TextField', () => {
  describe('edit mode', () => {
    it('should render text input with label', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
        />
      )

      expect(screen.getByLabelText('Username')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display current value', () => {
      render(
        <TextField
          name="username"
          value="john"
          onChange={vi.fn()}
          label="Username"
        />
      )

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('john')
    })

    it('should call onChange when user types', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(
        <TextField
          name="username"
          value=""
          onChange={onChange}
          label="Username"
        />
      )

      const input = screen.getByRole('textbox')
      await user.type(input, 't')

      expect(onChange).toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledWith('t')
    })

    it('should show required indicator when required', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
          required
        />
      )

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should display error message', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
          error="Username is required"
        />
      )

      expect(screen.getByText('Username is required')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
          disabled
        />
      )

      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('should show placeholder text', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
          placeholder="Enter your username"
        />
      )

      expect(screen.getByPlaceholderText('Enter your username')).toBeInTheDocument()
    })
  })

  describe('read mode', () => {
    it('should render value as text', () => {
      render(
        <TextField
          name="username"
          value="john"
          onChange={vi.fn()}
          label="Username"
          mode="read"
        />
      )

      expect(screen.getByText('Username')).toBeInTheDocument()
      expect(screen.getByText('john')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show dash when value is empty', () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={vi.fn()}
          label="Username"
          mode="read"
        />
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })
})
