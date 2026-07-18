import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { text } from '@opensaas/stack-core/fields'
import type { FieldConfig } from '@opensaas/stack-core'

import { ListTable } from '../../src/components/standalone/ListTable.js'
import { SearchBar } from '../../src/components/standalone/SearchBar.js'
import { DeleteButton } from '../../src/components/standalone/DeleteButton.js'
import { ItemCreateForm } from '../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../src/components/standalone/ItemEditForm.js'
import { RelationshipManager } from '../../src/components/fields/RelationshipManager.js'

// Next.js navigation is used by SearchBar.
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/posts',
}))

/**
 * Contract test suite for the composite `data-slot` + structured `classNames`
 * promise (issue #709). Each composite part must expose a stable `data-slot`
 * name AND merge a caller `classNames` slot via tailwind-merge so instance
 * overrides win. Assertions are on external behaviour only — the rendered
 * node's `data-slot` attribute and its resolved class list — never internal
 * structure.
 */

const findSlot = (container: HTMLElement, slot: string): Element | null =>
  container.querySelector(`[data-slot="${slot}"]`)

describe('ListTable classNames + data-slot contract', () => {
  const items = [
    { id: '1', title: 'First', status: 'published' },
    { id: '2', title: 'Second', status: 'draft' },
  ]
  const fieldTypes = { title: 'text', status: 'select' }

  it('exposes the list-table root data-slot', () => {
    const { container } = render(<ListTable items={items} fieldTypes={fieldTypes} />)
    expect(findSlot(container, 'list-table')).toHaveAttribute('data-slot', 'list-table')
  })

  it('merges classNames.root onto the root and classNames.frame onto the frame', () => {
    const { container } = render(
      <ListTable
        items={items}
        fieldTypes={fieldTypes}
        classNames={{ root: 'os-root', frame: 'os-frame' }}
      />,
    )
    expect(findSlot(container, 'list-table')).toHaveClass('os-root')
    expect(findSlot(container, 'list-table-frame')).toHaveClass('os-frame')
  })

  it('overrides a body cell default via classNames.cell (tailwind-merge)', () => {
    const withDefault = render(<ListTable items={items} fieldTypes={fieldTypes} />)
    const defaultCell = withDefault.container.querySelector(
      '[data-slot="table-body"] [data-slot="table-cell"]',
    )
    expect(defaultCell).toHaveClass('p-4')

    const withOverride = render(
      <ListTable items={items} fieldTypes={fieldTypes} classNames={{ cell: 'p-8' }} />,
    )
    const overriddenCell = withOverride.container.querySelector(
      '[data-slot="table-body"] [data-slot="table-cell"]',
    )
    expect(overriddenCell).toHaveClass('p-8')
    expect(overriddenCell).not.toHaveClass('p-4')
  })

  it('merges classNames.row onto body rows and classNames.headerCell onto head cells', () => {
    const { container } = render(
      <ListTable
        items={items}
        fieldTypes={fieldTypes}
        classNames={{ row: 'os-row', headerCell: 'os-head' }}
      />,
    )
    const bodyRow = container.querySelector('[data-slot="table-body"] [data-slot="table-row"]')
    expect(bodyRow).toHaveClass('os-row')
    expect(findSlot(container, 'table-head')).toHaveClass('os-head')
  })

  it('carries the empty-state data-slot and merges classNames.empty', () => {
    const { container } = render(
      <ListTable items={[]} fieldTypes={fieldTypes} classNames={{ empty: 'os-empty' }} />,
    )
    const empty = findSlot(container, 'list-table-empty')
    expect(empty).toHaveAttribute('data-slot', 'list-table-empty')
    expect(empty).toHaveClass('os-empty')
  })
})

describe('SearchBar classNames + data-slot contract', () => {
  it('exposes the search-bar and form data-slots', () => {
    const { container } = render(<SearchBar />)
    expect(findSlot(container, 'search-bar')).toHaveAttribute('data-slot', 'search-bar')
    expect(findSlot(container, 'search-bar-form')).toHaveAttribute('data-slot', 'search-bar-form')
  })

  it('merges classNames.form and overrides the input padding default', () => {
    const { container } = render(<SearchBar classNames={{ form: 'os-form', input: 'pr-2' }} />)
    expect(findSlot(container, 'search-bar-form')).toHaveClass('os-form')
    const input = findSlot(container, 'input')
    expect(input).toHaveClass('pr-2')
    // Default `pr-10` gives way to the caller's `pr-2`.
    expect(input).not.toHaveClass('pr-10')
  })
})

describe('DeleteButton classNames + data-slot contract', () => {
  it('merges classNames.button onto the trigger button', () => {
    const { container } = render(
      <DeleteButton onDelete={vi.fn()} classNames={{ button: 'os-delete' }} />,
    )
    expect(findSlot(container, 'button')).toHaveClass('os-delete')
  })
})

describe('Item forms classNames + data-slot contract', () => {
  const fields: Record<string, FieldConfig> = {
    title: text({ validation: { isRequired: true } }),
  }

  it('ItemCreateForm exposes its data-slots and merges classNames slots', () => {
    const { container } = render(
      <ItemCreateForm
        fields={fields}
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
        onCancel={vi.fn()}
        classNames={{ root: 'os-form', fields: 'os-fields', actions: 'os-actions' }}
      />,
    )
    const form = findSlot(container, 'item-create-form')
    expect(form).toHaveAttribute('data-slot', 'item-create-form')
    expect(form).toHaveClass('os-form')
    expect(findSlot(container, 'form-fields')).toHaveClass('os-fields')
    expect(findSlot(container, 'form-actions')).toHaveClass('os-actions')
  })

  it('ItemEditForm exposes its data-slots and merges classNames slots', () => {
    const { container } = render(
      <ItemEditForm
        fields={fields}
        initialData={{ title: 'Hi' }}
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
        classNames={{ root: 'os-form', actions: 'os-actions' }}
      />,
    )
    const form = findSlot(container, 'item-edit-form')
    expect(form).toHaveAttribute('data-slot', 'item-edit-form')
    expect(form).toHaveClass('os-form')
    expect(findSlot(container, 'form-actions')).toHaveClass('os-actions')
  })
})

describe('RelationshipManager classNames + data-slot contract', () => {
  const items = [
    { id: 't1', label: 'engineering' },
    { id: 't2', label: 'design' },
  ]

  it('exposes the relationship-manager root and merges classNames.frame', () => {
    const { container } = render(
      <RelationshipManager
        name="tags"
        value={['t1']}
        onChange={vi.fn()}
        label="Tags"
        items={items}
        classNames={{ root: 'os-rm', frame: 'os-frame' }}
      />,
    )
    const root = findSlot(container, 'relationship-manager')
    expect(root).toHaveAttribute('data-slot', 'relationship-manager')
    expect(root).toHaveClass('os-rm')
    expect(findSlot(container, 'relationship-manager-frame')).toHaveClass('os-frame')
  })

  it('merges classNames.emptyState onto the empty state and connectButton onto the trigger', () => {
    const { container } = render(
      <RelationshipManager
        name="tags"
        value={[]}
        onChange={vi.fn()}
        label="Tags"
        items={items}
        classNames={{ emptyState: 'os-empty', connectButton: 'os-connect' }}
      />,
    )
    expect(findSlot(container, 'relationship-manager-empty')).toHaveClass('os-empty')
    expect(findSlot(container, 'combobox-trigger')).toHaveClass('os-connect')
  })
})

describe('required field marker (shared shell) still renders', () => {
  it('shows the * marker for a required field in a form', () => {
    const fields: Record<string, FieldConfig> = {
      title: text({ validation: { isRequired: true } }),
    }
    render(
      <ItemCreateForm fields={fields} onSubmit={vi.fn().mockResolvedValue({ success: true })} />,
    )
    expect(screen.getByText('*')).toBeInTheDocument()
  })
})
