import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectField } from '../../src/components/fields/SelectField.js'

describe('SelectField', () => {
  const mockOptions = [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
    { label: 'Archived', value: 'archived' },
  ]

  describe('edit mode', () => {
    it('should render select with label', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
        />,
      )

      expect(screen.getByText('Status')).toBeInTheDocument()
      // Select is rendered as a button with role combobox
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should display default placeholder when no value selected', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
        />,
      )

      // The component uses a hard-coded placeholder text
      expect(screen.getByText('Select an option...')).toBeInTheDocument()
    })

    it('should display current selected value label', () => {
      render(
        <SelectField
          name="status"
          value="published"
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
        />,
      )

      // Should show the selected option label in the select trigger
      expect(screen.getByText('Published')).toBeInTheDocument()
    })

    it('should show required indicator when required', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          required
        />,
      )

      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should display error message', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          error="Status is required"
        />,
      )

      expect(screen.getByText('Status is required')).toBeInTheDocument()
    })

    it('should be disabled when disabled prop is true', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          disabled
        />,
      )

      const select = screen.getByRole('combobox')
      expect(select).toBeDisabled()
    })

    it('should render select trigger element', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
        />,
      )

      // Select trigger should be present
      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
    })
  })

  describe('read mode', () => {
    it('should render selected value as text', () => {
      render(
        <SelectField
          name="status"
          value="published"
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          mode="read"
        />,
      )

      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Published')).toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('should show dash when no value selected', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          mode="read"
        />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should show dash for invalid value', () => {
      render(
        <SelectField
          name="status"
          value="invalid"
          onChange={vi.fn()}
          label="Status"
          options={mockOptions}
          mode="read"
        />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle empty options array', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={[]}
        />,
      )

      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should handle single option array', () => {
      render(
        <SelectField
          name="status"
          value=""
          onChange={vi.fn()}
          label="Status"
          options={[{ label: 'Only Option', value: 'only' }]}
        />,
      )

      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })
  })
})
