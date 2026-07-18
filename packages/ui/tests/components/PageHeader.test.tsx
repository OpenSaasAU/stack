import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../../src/components/PageHeader.js'

// next/link renders an anchor; forward all props so href/className survive.
vi.mock('next/link.js', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const findSlot = (container: HTMLElement, slot: string): Element | null =>
  container.querySelector(`[data-slot="${slot}"]`)

describe('PageHeader', () => {
  it('renders the title as an h1 and exposes the header data-slots', () => {
    const { container } = render(<PageHeader title="Posts" />)
    const title = findSlot(container, 'page-header-title')
    expect(title).toHaveAttribute('data-slot', 'page-header-title')
    expect(title?.tagName).toBe('H1')
    expect(title).toHaveTextContent('Posts')
    expect(findSlot(container, 'page-header')).toBeInTheDocument()
  })

  it('renders a description when provided', () => {
    const { container } = render(<PageHeader title="Posts" description="12 items" />)
    expect(findSlot(container, 'page-header-description')).toHaveTextContent('12 items')
  })

  it('omits the description slot when not provided', () => {
    const { container } = render(<PageHeader title="Posts" />)
    expect(findSlot(container, 'page-header-description')).toBeNull()
  })

  it('renders a back link pointing at backHref with the given label', () => {
    render(<PageHeader title="Edit Post" backHref="/admin/post" backLabel="Back to Post" />)
    const back = screen.getByRole('link', { name: /back to post/i })
    expect(back).toHaveAttribute('href', '/admin/post')
    expect(back).toHaveAttribute('data-slot', 'page-header-back')
  })

  it('omits the back link when backHref is absent', () => {
    const { container } = render(<PageHeader title="Posts" />)
    expect(findSlot(container, 'page-header-back')).toBeNull()
  })

  it('renders the actions slot content', () => {
    const { container } = render(
      <PageHeader title="Posts" actions={<button type="button">Create</button>} />,
    )
    const actions = findSlot(container, 'page-header-actions')
    expect(actions).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('renders a leading icon only when provided', () => {
    const withIcon = render(<PageHeader title="Dashboard" icon={<svg data-testid="ic" />} />)
    expect(findSlot(withIcon.container, 'page-header-icon')).toBeInTheDocument()

    const withoutIcon = render(<PageHeader title="Dashboard" />)
    expect(findSlot(withoutIcon.container, 'page-header-icon')).toBeNull()
  })

  it('applies the gradient framing only when requested', () => {
    const plain = render(<PageHeader title="Posts" />)
    expect(findSlot(plain.container, 'page-header')?.className).not.toContain('gradient')

    const gradient = render(<PageHeader title="Dashboard" gradient />)
    expect(findSlot(gradient.container, 'page-header')?.className).toContain('gradient')
  })

  it('merges classNames slots via tailwind-merge so caller classes win', () => {
    const { container } = render(
      <PageHeader
        title="Posts"
        description="x"
        classNames={{ root: 'os-root', title: 'os-title', description: 'os-desc' }}
      />,
    )
    expect(findSlot(container, 'page-header')).toHaveClass('os-root')
    expect(findSlot(container, 'page-header-title')).toHaveClass('os-title')
    expect(findSlot(container, 'page-header-description')).toHaveClass('os-desc')
  })
})
