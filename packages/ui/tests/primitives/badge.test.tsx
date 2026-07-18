import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { Badge } from '../../src/primitives/badge.js'

/**
 * Status rendering contract (issue #709): the Badge primitive renders
 * `success` / `warning` / `destructive` states through theme-token utilities
 * only — no hardcoded status colours. Assertions are on external behaviour: the
 * `data-slot` attribute and the token-based classes present on the rendered
 * node.
 */
describe('Badge status tokens', () => {
  it('carries the stable data-slot', () => {
    const { container } = render(<Badge>New</Badge>)
    expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute('data-slot', 'badge')
  })

  it('renders the success variant from the success token', () => {
    const { container } = render(<Badge variant="success">Published</Badge>)
    expect(container.querySelector('[data-slot="badge"]')).toHaveClass('text-success')
  })

  it('renders the warning variant from the warning token', () => {
    const { container } = render(<Badge variant="warning">Draft</Badge>)
    expect(container.querySelector('[data-slot="badge"]')).toHaveClass('text-warning')
  })

  it('renders the destructive variant from the destructive token', () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>)
    expect(container.querySelector('[data-slot="badge"]')).toHaveClass('text-destructive')
  })

  it('merges a caller className onto the badge', () => {
    const { container } = render(<Badge className="os-badge">Tag</Badge>)
    expect(container.querySelector('[data-slot="badge"]')).toHaveClass('os-badge')
  })
})
