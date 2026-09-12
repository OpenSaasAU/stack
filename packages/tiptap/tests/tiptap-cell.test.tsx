import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TiptapCell } from '../src/components/TiptapCell.js'
import type { JSONContent } from '@tiptap/react'

/**
 * The list view falls back to `String(value)` for a field type with no
 * registered Cell, which reads Tiptap's JSON document as `[object Object]`
 * (issue #1418). `TiptapCell` extracts a plain-text excerpt instead.
 */
describe('TiptapCell', () => {
  it('renders a plain-text excerpt of the document', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    }
    render(<TiptapCell value={doc} field={{ type: 'richText' }} fieldName="content" />)
    const cell = screen.getByText('Hello world')
    expect(cell).toHaveAttribute('data-slot', 'cell-richtext')
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('joins text across multiple nodes', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] },
      ],
    }
    render(<TiptapCell value={doc} field={{ type: 'richText' }} fieldName="content" />)
    expect(screen.getByText('First. Second.')).toBeInTheDocument()
  })

  it('truncates a long excerpt', () => {
    const longText = 'x'.repeat(200)
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }],
    }
    render(<TiptapCell value={doc} field={{ type: 'richText' }} fieldName="content" />)
    const cell = screen.getByText(/…$/)
    expect(cell.textContent?.length).toBeLessThan(longText.length)
  })

  it('renders a dash for an empty document or null value', () => {
    render(<TiptapCell value={null} field={{ type: 'richText' }} fieldName="content" />)
    expect(screen.getByText('-')).toBeInTheDocument()

    const emptyDoc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    render(<TiptapCell value={emptyDoc} field={{ type: 'richText' }} fieldName="content" />)
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })
})
