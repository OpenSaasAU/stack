import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../../../src/primitives/dialog.js'
import { Button } from '../../../src/primitives/button.js'

describe('Dialog (Browser)', () => {
  it('should render dialog trigger', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    expect(trigger).toBeInTheDocument()
  })

  it('should open dialog when trigger is clicked', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Dialog Title')).toBeInTheDocument()
      expect(screen.getByText('Dialog description')).toBeInTheDocument()
    })
  })

  it('should close dialog when close button is clicked', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Click the X close button
    const closeButton = screen.getByRole('button', { name: 'Close' })
    await userEvent.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should close dialog with DialogClose component', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    await userEvent.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should close dialog when escape key is pressed', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should render overlay when dialog is open', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      const overlay = document.querySelector('[data-state="open"]')
      expect(overlay).toBeInTheDocument()
    })
  })

  it('should trap focus within dialog when open', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button>First Button</Button>
            <Button>Second Button</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Open Dialog' })
    await userEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Tab through focusable elements
    await userEvent.keyboard('{Tab}')

    // Focus should be within the dialog
    const firstButton = screen.getByRole('button', { name: 'First Button' })
    const secondButton = screen.getByRole('button', { name: 'Second Button' })

    const activeElement = document.activeElement
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(activeElement)).toBe(true)
  })
})
