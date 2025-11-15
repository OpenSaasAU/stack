import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CheckboxField } from '../../src/components/fields/CheckboxField.js'

describe('CheckboxField', () => {
  describe('edit mode', () => {
    it('should render checkbox with label', () => {
      render(<CheckboxField name="active" value={false} onChange={vi.fn()} label="Is Active" />)

      expect(screen.getByLabelText('Is Active')).toBeInTheDocument()
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })

    it('should display checked state when value is true', () => {
      render(<CheckboxField name="active" value={true} onChange={vi.fn()} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })

    it('should display unchecked state when value is false', () => {
      render(<CheckboxField name="active" value={false} onChange={vi.fn()} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })

    it('should call onChange with true when clicked', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<CheckboxField name="active" value={false} onChange={onChange} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      await user.click(checkbox)

      expect(onChange).toHaveBeenCalledWith(true)
    })

    it('should call onChange with false when unchecked', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(<CheckboxField name="active" value={true} onChange={onChange} label="Is Active" />)

      const checkbox = screen.getByRole('checkbox')
      await user.click(checkbox)

      expect(onChange).toHaveBeenCalledWith(false)
    })

    it('should display error message', () => {
      render(
        <CheckboxField
          name="terms"
          value={false}
          onChange={vi.fn()}
          label="Accept Terms"
          error="You must accept the terms"
        />,
      )

      expect(screen.getByText('You must accept the terms')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(
        <CheckboxField name="active" value={false} onChange={vi.fn()} label="Is Active" disabled />,
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })

    it('should not be clickable when disabled', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()

      render(
        <CheckboxField
          name="active"
          value={false}
          onChange={onChange}
          label="Is Active"
          disabled
        />,
      )

      const checkbox = screen.getByRole('checkbox')
      await user.click(checkbox)

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('read mode', () => {
    it('should render "Yes" when value is true', () => {
      render(
        <CheckboxField
          name="active"
          value={true}
          onChange={vi.fn()}
          label="Is Active"
          mode="read"
        />,
      )

      expect(screen.getByText('Is Active')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('should render "No" when value is false', () => {
      render(
        <CheckboxField
          name="active"
          value={false}
          onChange={vi.fn()}
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
