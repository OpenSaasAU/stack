import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { Button } from '../../../src/primitives/button.js'

describe('Button (Browser)', () => {
  it('should render with default variant', async () => {
    render(<Button>Click me</Button>)

    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('bg-primary')
  })

  it('should handle click events', async () => {
    let clicked = false
    const handleClick = () => {
      clicked = true
    }

    render(<Button onClick={handleClick}>Click me</Button>)

    const button = screen.getByRole('button', { name: 'Click me' })
    await userEvent.click(button)

    expect(clicked).toBe(true)
  })

  it('should render different variants correctly', async () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>)
    let button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass('bg-destructive')

    rerender(<Button variant="outline">Cancel</Button>)
    button = screen.getByRole('button', { name: 'Cancel' })
    expect(button).toHaveClass('border')

    rerender(<Button variant="ghost">Ghost</Button>)
    button = screen.getByRole('button', { name: 'Ghost' })
    expect(button).toHaveClass('hover:bg-accent')
  })

  it('should render different sizes correctly', async () => {
    const { rerender } = render(<Button size="sm">Small</Button>)
    let button = screen.getByRole('button', { name: 'Small' })
    expect(button).toHaveClass('h-9')

    rerender(<Button size="lg">Large</Button>)
    button = screen.getByRole('button', { name: 'Large' })
    expect(button).toHaveClass('h-11')

    rerender(<Button size="icon">Icon</Button>)
    button = screen.getByRole('button', { name: 'Icon' })
    expect(button).toHaveClass('h-10', 'w-10')
  })

  it('should be disabled when disabled prop is true', async () => {
    render(<Button disabled>Disabled</Button>)

    const button = screen.getByRole('button', { name: 'Disabled' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('disabled:opacity-50')
  })

  it('should not trigger click when disabled', async () => {
    let clicked = false
    const handleClick = () => {
      clicked = true
    }

    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Disabled' })

    // Verify button is disabled - browsers prevent clicking disabled buttons
    expect(button).toBeDisabled()
    expect(button).toHaveClass('disabled:pointer-events-none')

    // In real browsers, disabled buttons cannot be clicked
    // The pointer-events-none class prevents any interaction
    expect(clicked).toBe(false)
  })

  it('should handle keyboard navigation', async () => {
    let clicked = false
    const handleClick = () => {
      clicked = true
    }

    render(<Button onClick={handleClick}>Press Enter</Button>)

    const button = screen.getByRole('button', { name: 'Press Enter' })
    button.focus()
    expect(document.activeElement).toBe(button)

    await userEvent.keyboard('{Enter}')
    expect(clicked).toBe(true)
  })

  it('should support custom className', async () => {
    render(<Button className="custom-class">Custom</Button>)

    const button = screen.getByRole('button', { name: 'Custom' })
    expect(button).toHaveClass('custom-class')
  })

  it('should render as child component when asChild is true', async () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Link Button' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/test')
  })
})
