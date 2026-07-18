import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../../src/components/EmptyState.js'

const findSlot = (container: HTMLElement, slot: string): Element | null =>
  container.querySelector(`[data-slot="${slot}"]`)

describe('EmptyState', () => {
  it('renders the title and root data-slot', () => {
    const { container } = render(<EmptyState title="No items yet" />)
    const root = findSlot(container, 'empty-state')
    expect(root).toHaveAttribute('data-slot', 'empty-state')
    expect(findSlot(container, 'empty-state-title')).toHaveTextContent('No items yet')
  })

  it('renders the description when provided and omits it otherwise', () => {
    const withDesc = render(<EmptyState title="Empty" description="Create your first record." />)
    expect(findSlot(withDesc.container, 'empty-state-description')).toHaveTextContent(
      'Create your first record.',
    )

    const withoutDesc = render(<EmptyState title="Empty" />)
    expect(findSlot(withoutDesc.container, 'empty-state-description')).toBeNull()
  })

  it('renders an icon only when provided', () => {
    const withIcon = render(<EmptyState title="Empty" icon="📭" />)
    expect(findSlot(withIcon.container, 'empty-state-icon')).toHaveTextContent('📭')

    const withoutIcon = render(<EmptyState title="Empty" />)
    expect(findSlot(withoutIcon.container, 'empty-state-icon')).toBeNull()
  })

  it('renders actions content when provided', () => {
    render(<EmptyState title="Empty" actions={<button type="button">Create</button>} />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('merges classNames slots so caller classes win', () => {
    const { container } = render(
      <EmptyState
        title="Empty"
        icon="x"
        description="y"
        classNames={{ root: 'os-root', title: 'os-title', icon: 'os-icon', description: 'os-desc' }}
      />,
    )
    expect(findSlot(container, 'empty-state')).toHaveClass('os-root')
    expect(findSlot(container, 'empty-state-title')).toHaveClass('os-title')
    expect(findSlot(container, 'empty-state-icon')).toHaveClass('os-icon')
    expect(findSlot(container, 'empty-state-description')).toHaveClass('os-desc')
  })
})
