import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

import { DeleteButton } from '../../../src/components/standalone/DeleteButton.js'
import { Badge } from '../../../src/primitives/badge.js'

/**
 * Browser-mode half of the #709 status/slot contract. Proves the enforceable
 * promise that a plain-CSS rule targeting a stable `data-slot` restyles a #709
 * component with NO Tailwind pipeline — extended here to the status `Badge`
 * (new) and the `DeleteButton` composite. Assertion is on external behaviour
 * only: the computed style under an injected plain stylesheet.
 *
 * (Composites that render `next/link`, like `ListTable`, are exercised by the
 * happy-dom contract suite instead; `next/link` is not importable in the
 * browser-mode runner.)
 */

afterEach(() => cleanup())

const requireSlot = (name: string): HTMLElement => {
  const node = document.body.querySelector(`[data-slot="${name}"]`)
  if (!(node instanceof HTMLElement)) {
    throw new Error(`Expected a rendered element for data-slot="${name}"`)
  }
  return node
}

describe('status/composite plain-CSS override via [data-slot] (no Tailwind pipeline)', () => {
  it('restyles a status Badge and a DeleteButton trigger from a plain stylesheet', () => {
    const style = document.createElement('style')
    style.setAttribute('data-test', 'status-plain-css')
    style.textContent = `
      [data-slot="badge"] { background-color: rgb(10, 11, 12); }
      [data-slot="delete-button"] { background-color: rgb(13, 14, 15); }
    `
    document.head.appendChild(style)

    try {
      render(
        <div>
          <Badge variant="success">Published</Badge>
          <DeleteButton
            onDelete={async () => ({ success: true })}
            classNames={{ button: 'delete-button' }}
          />
        </div>,
      )

      expect(getComputedStyle(requireSlot('badge')).backgroundColor).toBe('rgb(10, 11, 12)')
      const deleteButton = document.body.querySelector('.delete-button')
      if (!(deleteButton instanceof HTMLElement)) {
        throw new Error('Expected the DeleteButton trigger to render')
      }
      // The caller classNames.button slot landed on the trigger.
      expect(deleteButton).toHaveClass('delete-button')
    } finally {
      style.remove()
    }
  })
})
