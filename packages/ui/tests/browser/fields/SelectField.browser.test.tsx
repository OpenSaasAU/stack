import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { SelectField } from '../../../src/components/fields/SelectField.js'

const mockOptions = [
  { label: 'Option 1', value: 'option1' },
  { label: 'Option 2', value: 'option2' },
  { label: 'Option 3', value: 'option3' },
]

describe('SelectField (Browser)', () => {
  describe('edit mode', () => {
    it('should render select field with label', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
        />,
      )

      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should display selected value', async () => {
      render(
        <SelectField
          name="status"
          value="option2"
          onChange={() => {}}
          label="Status"
          options={mockOptions}
        />,
      )

      expect(screen.getByRole('combobox')).toHaveTextContent('Option 2')
    })

    it('should open dropdown when clicked', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
        />,
      )

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument()
      })
    })

    it('should call onChange when option is selected', async () => {
      let selectedValue: string | null = null
      const handleChange = (value: string | null) => {
        selectedValue = value
      }

      render(
        <SelectField
          name="status"
          value={null}
          onChange={handleChange}
          label="Status"
          options={mockOptions}
        />,
      )

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument()
      })

      const option = screen.getByRole('option', { name: 'Option 2' })
      await userEvent.click(option)

      expect(selectedValue).toBe('option2')
    })

    it('should show required indicator when required', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
          required
        />,
      )

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should display error message', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
          error="Status is required"
        />,
      )

      expect(screen.getByText('Status is required')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
          disabled
        />,
      )

      const trigger = screen.getByRole('combobox')
      expect(trigger).toBeDisabled()
    })

    it('should support keyboard navigation', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
        />,
      )

      const trigger = screen.getByRole('combobox')
      trigger.focus()
      expect(document.activeElement).toBe(trigger)

      // Open with Space key (more reliable than Enter for Radix Select)
      await userEvent.keyboard(' ')

      await waitFor(
        () => {
          expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument()
        },
        { timeout: 3000 },
      )
    })

    it('should close dropdown when Escape is pressed', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
        />,
      )

      const trigger = screen.getByRole('combobox')
      await userEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument()
      })

      await userEvent.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('option', { name: 'Option 1' })).not.toBeInTheDocument()
      })
    })
  })

  describe('read mode', () => {
    it('should render selected option label', async () => {
      render(
        <SelectField
          name="status"
          value="option2"
          onChange={() => {}}
          label="Status"
          options={mockOptions}
          mode="read"
        />,
      )

      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Option 2')).toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('should show dash when value is null', async () => {
      render(
        <SelectField
          name="status"
          value={null}
          onChange={() => {}}
          label="Status"
          options={mockOptions}
          mode="read"
        />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })
})
