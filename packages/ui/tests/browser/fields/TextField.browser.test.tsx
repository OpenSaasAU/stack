import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import React from 'react'
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

    it('should handle programmatic value changes', async () => {
      function TestComponent() {
        const [value, setValue] = React.useState('')
        return (
          <div>
            <button onClick={() => setValue('programmatic value')}>Set Value</button>
            <TextField name="username" value={value} onChange={setValue} label="Username" />
          </div>
        )
      }

      await act(async () => {
        render(<TestComponent />)
      })

      const input = screen.getByRole('textbox')
      const button = screen.getByRole('button')

      // Click button to set value programmatically
      await act(async () => {
        await userEvent.click(button)
      })

      await waitFor(() => {
        expect(input).toHaveValue('programmatic value')
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

    it('should handle text input with keyboard', async () => {
      function TestComponent() {
        const [value, setValue] = React.useState('')
        return <TextField name="username" value={value} onChange={setValue} label="Username" />
      }

      await act(async () => {
        render(<TestComponent />)
      })

      const input = screen.getByRole('textbox')

      await act(async () => {
        await userEvent.click(input)
      })

      await act(async () => {
        await userEvent.keyboard('test123')
      })

      await waitFor(() => {
        expect(input).toHaveValue('test123')
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
