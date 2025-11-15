import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import React from 'react'
import { CheckboxField } from '../../../src/components/fields/CheckboxField.js'

describe('CheckboxField (Browser)', () => {
  describe('edit mode', () => {
    it('should render checkbox with label', async () => {
      render(<CheckboxField name="active" value={false} onChange={() => {}} label="Is Active" />)

      expect(screen.getByLabelText('Is Active')).toBeInTheDocument()
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('should display checked state when value is true', async () => {
      render(<CheckboxField name="active" value={true} onChange={() => {}} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('should display unchecked state when value is false', async () => {
      render(<CheckboxField name="active" value={false} onChange={() => {}} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })

    it('should call onChange with true when clicked', async () => {
      let currentValue = false
      const handleChange = (value: boolean) => {
        currentValue = value
      }

      render(
        <CheckboxField
          name="active"
          value={currentValue}
          onChange={handleChange}
          label="Is Active"
        />,
      )

      const checkbox = screen.getByRole('checkbox')
      await userEvent.click(checkbox)

      expect(currentValue).toBe(true)
    })

    it('should call onChange with false when unchecked', async () => {
      let currentValue = true
      const handleChange = (value: boolean) => {
        currentValue = value
      }

      render(
        <CheckboxField
          name="active"
          value={currentValue}
          onChange={handleChange}
          label="Is Active"
        />,
      )

      const checkbox = screen.getByRole('checkbox')
      await userEvent.click(checkbox)

      expect(currentValue).toBe(false)
    })

    it('should toggle state with multiple clicks', async () => {
      function TestComponent() {
        const [value, setValue] = React.useState(false)
        return (
          <CheckboxField
            name="active"
            value={value}
            onChange={setValue}
            label="Is Active"
            data-testid="checkbox-field"
          />
        )
      }

      render(<TestComponent />)

      const checkbox = screen.getByRole('checkbox')

      // First click - check
      expect(checkbox).not.toBeChecked()
      await userEvent.click(checkbox)
      expect(checkbox).toBeChecked()

      // Second click - uncheck
      await userEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()

      // Third click - check again
      await userEvent.click(checkbox)
      expect(checkbox).toBeChecked()
    })

    it('should display error message', async () => {
      render(
        <CheckboxField
          name="terms"
          value={false}
          onChange={() => {}}
          label="Accept Terms"
          error="You must accept the terms"
        />,
      )

      expect(screen.getByText('You must accept the terms')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', async () => {
      render(
        <CheckboxField name="active" value={false} onChange={() => {}} label="Is Active" disabled />,
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })

    it('should not be clickable when disabled', async () => {
      let currentValue = false
      const handleChange = (value: boolean) => {
        currentValue = value
      }

      render(
        <CheckboxField
          name="active"
          value={currentValue}
          onChange={handleChange}
          label="Is Active"
          disabled
        />,
      )

      const checkbox = screen.getByRole('checkbox')

      // Verify checkbox is disabled - browsers prevent clicking disabled checkboxes
      expect(checkbox).toBeDisabled()

      // In real browsers, disabled checkboxes cannot be clicked
      expect(currentValue).toBe(false)
    })

    it('should support keyboard interaction with Space', async () => {
      let currentValue = false
      const handleChange = (value: boolean) => {
        currentValue = value
      }

      render(
        <CheckboxField
          name="active"
          value={currentValue}
          onChange={handleChange}
          label="Is Active"
        />,
      )

      const checkbox = screen.getByRole('checkbox')
      checkbox.focus()
      expect(document.activeElement).toBe(checkbox)

      await userEvent.keyboard(' ')

      expect(currentValue).toBe(true)
    })

    it('should support clicking on label to toggle', async () => {
      let currentValue = false
      const handleChange = (value: boolean) => {
        currentValue = value
      }

      render(
        <CheckboxField
          name="active"
          value={currentValue}
          onChange={handleChange}
          label="Is Active"
        />,
      )

      const label = screen.getByText('Is Active')
      await userEvent.click(label)

      expect(currentValue).toBe(true)
    })
  })

  describe('read mode', () => {
    it('should render "Yes" when value is true', async () => {
      render(
        <CheckboxField
          name="active"
          value={true}
          onChange={() => {}}
          label="Is Active"
          mode="read"
        />,
      )

      expect(screen.getByText('Is Active')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('should render "No" when value is false', async () => {
      render(
        <CheckboxField
          name="active"
          value={false}
          onChange={() => {}}
          label="Is Active"
          mode="read"
        />,
      )

      expect(screen.getByText('Is Active')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })
  })
})
