import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteButton } from '../../src/components/standalone/DeleteButton.js'

describe('DeleteButton', () => {
  const mockOnDelete = vi.fn()

  beforeEach(() => {
    mockOnDelete.mockClear()
  })

  describe('rendering', () => {
    it('should render delete button', () => {
      render(<DeleteButton onDelete={mockOnDelete} />)

      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('should use custom button label', () => {
      render(<DeleteButton onDelete={mockOnDelete} buttonLabel="Remove" />)

      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      render(<DeleteButton onDelete={mockOnDelete} className="custom-class" />)

      const button = screen.getByRole('button', { name: /delete/i })
      expect(button).toHaveClass('custom-class')
    })

    it('should be disabled when disabled prop is true', () => {
      render(<DeleteButton onDelete={mockOnDelete} disabled />)

      const button = screen.getByRole('button', { name: /delete/i })
      expect(button).toBeDisabled()
    })

    it('should not show confirmation dialog initially', () => {
      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      expect(screen.queryByText(/delete post/i)).not.toBeInTheDocument()
    })
  })

  describe('confirmation dialog', () => {
    it('should show confirmation dialog when button clicked', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByText(/delete post/i)).toBeInTheDocument()
    })

    it('should show default confirmation message', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(
        screen.getByText(/are you sure you want to delete this post/i),
      ).toBeInTheDocument()
    })

    it('should show custom confirmation title', async () => {
      const user = userEvent.setup()
      render(
        <DeleteButton onDelete={mockOnDelete} confirmTitle="Confirm Deletion" itemName="post" />,
      )

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByText('Confirm Deletion')).toBeInTheDocument()
    })

    it('should show custom confirmation message', async () => {
      const user = userEvent.setup()
      render(
        <DeleteButton
          onDelete={mockOnDelete}
          confirmMessage="This will permanently delete the post."
        />,
      )

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByText('This will permanently delete the post.')).toBeInTheDocument()
    })

    it('should show custom confirm label', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} confirmLabel="Yes, delete it" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument()
    })

    it('should show custom cancel label', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} cancelLabel="No, keep it" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(screen.getByRole('button', { name: 'No, keep it' })).toBeInTheDocument()
    })

    it('should close dialog when cancel button clicked', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText(/delete post/i)).not.toBeInTheDocument()
      })
    })

    it('should not call onDelete when cancel button clicked', async () => {
      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      expect(mockOnDelete).not.toHaveBeenCalled()
    })
  })

  describe('delete functionality', () => {
    it('should call onDelete when confirmed', async () => {
      mockOnDelete.mockResolvedValue({ success: true })
      const user = userEvent.setup()

      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalled()
      })
    })

    it('should close dialog when delete confirmed', async () => {
      mockOnDelete.mockResolvedValue({ success: true })
      const user = userEvent.setup()

      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.queryByText(/delete post/i)).not.toBeInTheDocument()
      })
    })

    it('should show loading state during delete', async () => {
      let resolveDelete: (value: { success: boolean }) => void
      const deletePromise = new Promise<{ success: boolean }>((resolve) => {
        resolveDelete = resolve
      })
      mockOnDelete.mockReturnValue(deletePromise)

      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /delete/i })
        expect(button).toBeDisabled()
      })

      resolveDelete!({ success: true })
    })

    it('should disable button during delete', async () => {
      let resolveDelete: (value: { success: boolean }) => void
      const deletePromise = new Promise<{ success: boolean }>((resolve) => {
        resolveDelete = resolve
      })
      mockOnDelete.mockReturnValue(deletePromise)

      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /delete/i })
        expect(button).toBeDisabled()
      })

      resolveDelete!({ success: true })

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /delete/i })
        expect(button).not.toBeDisabled()
      })
    })
  })

  describe('error handling', () => {
    it('should show error when delete fails with error message', async () => {
      mockOnDelete.mockResolvedValue({ success: false, error: 'Database error' })
      const user = userEvent.setup()

      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument()
      })
    })

    it('should show default error when delete fails without error message', async () => {
      mockOnDelete.mockResolvedValue({ success: false })
      const user = userEvent.setup()

      render(<DeleteButton onDelete={mockOnDelete} itemName="post" />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText('Failed to delete post')).toBeInTheDocument()
      })
    })

    it('should show error when delete throws exception', async () => {
      mockOnDelete.mockRejectedValue(new Error('Network error'))
      const user = userEvent.setup()

      render(<DeleteButton onDelete={mockOnDelete} />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should clear previous error on new delete attempt', async () => {
      mockOnDelete
        .mockResolvedValueOnce({ success: false, error: 'First error' })
        .mockResolvedValueOnce({ success: true })

      const user = userEvent.setup()
      render(<DeleteButton onDelete={mockOnDelete} />)

      // First attempt - fails
      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      const confirmButton1 = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton1)

      await waitFor(() => {
        expect(screen.getByText('First error')).toBeInTheDocument()
      })

      // Second attempt - succeeds
      await user.click(deleteButton)

      const confirmButton2 = screen.getByRole('button', { name: /^delete$/i })
      await user.click(confirmButton2)

      await waitFor(() => {
        expect(screen.queryByText('First error')).not.toBeInTheDocument()
      })
    })
  })

  describe('button variants and sizes', () => {
    it('should apply custom button variant', () => {
      render(<DeleteButton onDelete={mockOnDelete} buttonVariant="outline" />)

      const button = screen.getByRole('button', { name: /delete/i })
      expect(button).toBeInTheDocument()
    })

    it('should apply custom size', () => {
      render(<DeleteButton onDelete={mockOnDelete} size="sm" />)

      const button = screen.getByRole('button', { name: /delete/i })
      expect(button).toBeInTheDocument()
    })
  })
})
