import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { Avatar } from '../../src/primitives/avatar.js'

/**
 * Avatar primitive (issue #735). Assertions are on external, accessible
 * behaviour: the labelled-image role, the initials shown, the stable
 * `data-slot`, token-derived tone classes, and graceful degradation of an empty
 * name.
 */
describe('Avatar primitive', () => {
  it('carries the stable data-slot and labelled-image role', () => {
    const { container } = render(<Avatar name="Ada Lovelace" />)
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveAttribute('role', 'img')
    expect(avatar).toHaveAttribute('aria-label', 'Ada Lovelace')
  })

  it('shows deterministic initials', () => {
    const { container } = render(<Avatar name="Ada Lovelace" />)
    expect(container.querySelector('[data-slot="avatar"]')).toHaveTextContent('AL')
  })

  it('degrades gracefully for an empty name (neutral bubble, no blank circle)', () => {
    const { container } = render(<Avatar name="" />)
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toHaveTextContent('?')
    expect(avatar).toHaveAttribute('aria-label', 'Unknown')
  })

  it('tints with a theme-token tone class, never a raw colour', () => {
    const { container } = render(<Avatar name="Ada Lovelace" />)
    const className = container.querySelector('[data-slot="avatar"]')?.className ?? ''
    // A token background/foreground pair is applied (bg-*/text-*), no hex.
    expect(className).toMatch(
      /(bg-primary|bg-success|bg-warning|bg-destructive|bg-accent|bg-secondary)/,
    )
    expect(className).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('merges a caller className', () => {
    const { container } = render(<Avatar name="Ada" className="os-avatar" />)
    expect(container.querySelector('[data-slot="avatar"]')).toHaveClass('os-avatar')
  })

  it('hides itself from the accessibility tree when decorative', () => {
    const { container } = render(<Avatar name="Ada Lovelace" decorative />)
    const avatar = container.querySelector('[data-slot="avatar"]')
    // No name is contributed to the a11y tree — adjacent text carries identity.
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).not.toHaveAttribute('role')
    expect(avatar).not.toHaveAttribute('aria-label')
    // Initials still render visually.
    expect(avatar).toHaveTextContent('AL')
  })
})
