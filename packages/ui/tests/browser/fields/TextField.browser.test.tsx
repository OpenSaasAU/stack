import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { TextField } from '../../../src/components/fields/TextField.js'

describe('TextField (Browser)', () => {
  describe('edit mode', () => {
    it('should render text input with label', async () => {
      render(<TextField name="username" value="" onChange={() => {}} label="Username" />)

      expect(screen.getByLabelText('Username')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should display current value', async () => {
      render(<TextField name="username" value="john" onChange={() => {}} label="Username" />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('john')
    })

    it('should call onChange when user types', async () => {
      let currentValue = ''
      const handleChange = (value: string) => {
        currentValue = value
      }

      render(<TextField name="username" value="" onChange={handleChange} label="Username" />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'test')

      // Check that onChange was called and value updated
      expect(currentValue).toBeTruthy()
    })

    it('should handle clearing input', async () => {
      let currentValue = 'initial'
      const handleChange = (value: string) => {
        currentValue = value
      }

      render(
        <TextField name="username" value={currentValue} onChange={handleChange} label="Username" />,
      )

      const input = screen.getByRole('textbox')
      await userEvent.clear(input)

      expect(currentValue).toBe('')
    })

    it('should show required indicator when required', async () => {
      render(<TextField name="username" value="" onChange={() => {}} label="Username" required />)

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should display error message', async () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={() => {}}
          label="Username"
          error="Username is required"
        />,
      )

      expect(screen.getByText('Username is required')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', async () => {
      render(<TextField name="username" value="" onChange={() => {}} label="Username" disabled />)

      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('should not accept input when disabled', async () => {
      let currentValue = ''
      const handleChange = (value: string) => {
        currentValue = value
      }

      render(
        <TextField
          name="username"
          value={currentValue}
          onChange={handleChange}
          label="Username"
          disabled
        />,
      )

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'test')

      expect(currentValue).toBe('')
    })

    it('should show placeholder text', async () => {
      render(
        <TextField
          name="username"
          value=""
          onChange={() => {}}
          label="Username"
          placeholder="Enter your username"
        />,
      )

      expect(screen.getByPlaceholderText('Enter your username')).toBeInTheDocument()
    })

    it('should support copy and paste', async () => {
      let currentValue = ''
      const handleChange = (value: string) => {
        currentValue = value
      }

      render(<TextField name="username" value="" onChange={handleChange} label="Username" />)

      const input = screen.getByRole('textbox')

      // Paste text
      await userEvent.click(input)
      await userEvent.paste('pasted text')

      await waitFor(() => {
        expect(currentValue).toContain('pasted')
      })
    })

    it('should handle focus and blur events', async () => {
      render(<TextField name="username" value="" onChange={() => {}} label="Username" />)

      const input = screen.getByRole('textbox')

      // Focus
      input.focus()
      expect(document.activeElement).toBe(input)

      // Blur
      input.blur()
      expect(document.activeElement).not.toBe(input)
    })

    it('should handle special characters', async () => {
      let currentValue = ''
      const handleChange = (value: string) => {
        currentValue = value
      }

      render(<TextField name="username" value="" onChange={handleChange} label="Username" />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, '!@#$%^&*()')

      await waitFor(() => {
        expect(currentValue).toContain('!')
      })
    })
  })

  describe('read mode', () => {
    it('should render value as text', async () => {
      render(
        <TextField name="username" value="john" onChange={() => {}} label="Username" mode="read" />,
      )

      expect(screen.getByText('Username')).toBeInTheDocument()
      expect(screen.getByText('john')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show dash when value is empty', async () => {
      render(
        <TextField name="username" value="" onChange={() => {}} label="Username" mode="read" />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })
})
