import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

import { Input } from '../../../src/primitives/input.js'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../../../src/primitives/dialog.js'
import {
  Select,
  SelectGroup,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from '../../../src/primitives/select.js'
import { Popover, PopoverTrigger, PopoverContent } from '../../../src/primitives/popover.js'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearch,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxSeparator,
} from '../../../src/primitives/combobox.js'
import { Table, TableBody, TableRow, TableCell } from '../../../src/primitives/table.js'
import { DateTimePicker } from '../../../src/primitives/datetime-picker.js'
import { userEvent } from 'vitest/browser'

/**
 * Browser-mode half of the `data-slot` contract suite (issue #708, ADR-0016).
 *
 * Covers the portalled / open-state composite parts that Radix mounts into a
 * portal (Dialog, Select, Popover, Combobox content) plus the plain-CSS
 * override demonstration — the enforceable proof that a `[data-slot=…]` plain
 * CSS rule restyles a primitive with NO Tailwind pipeline. Assertions are on
 * external behaviour only: the rendered node's `data-slot` attribute, its
 * merged class list, and its computed style under an injected plain stylesheet.
 */

afterEach(() => cleanup())

const slot = (name: string): Element | null => document.body.querySelector(`[data-slot="${name}"]`)

/** Query a slot and narrow to HTMLElement without casting (fails loudly if absent). */
const requireSlot = (name: string): HTMLElement => {
  const node = slot(name)
  if (!(node instanceof HTMLElement)) {
    throw new Error(`Expected a rendered element for data-slot="${name}"`)
  }
  return node
}

describe('Dialog data-slot contract (browser)', () => {
  it('exposes stable data-slot names on every part', () => {
    render(
      <Dialog open>
        <DialogContent className="os-dialog">
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogHeader>
          <DialogFooter>footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    expect(slot('dialog-overlay')).toHaveAttribute('data-slot', 'dialog-overlay')
    expect(slot('dialog-content')).toHaveAttribute('data-slot', 'dialog-content')
    expect(slot('dialog-header')).toHaveAttribute('data-slot', 'dialog-header')
    expect(slot('dialog-footer')).toHaveAttribute('data-slot', 'dialog-footer')
    expect(slot('dialog-title')).toHaveAttribute('data-slot', 'dialog-title')
    expect(slot('dialog-description')).toHaveAttribute('data-slot', 'dialog-description')
    expect(slot('dialog-close')).toHaveAttribute('data-slot', 'dialog-close')
  })

  it('merges and overrides a caller className on the content (tailwind-merge)', () => {
    render(
      <Dialog open>
        <DialogContent className="os-dialog p-2">
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const content = slot('dialog-content')
    expect(content).toHaveClass('os-dialog')
    // Default padding `p-6` is dropped in favour of the caller's `p-2`.
    expect(content).toHaveClass('p-2')
    expect(content).not.toHaveClass('p-6')
  })
})

describe('Select data-slot contract (browser)', () => {
  it('exposes stable data-slot names on every open part', () => {
    render(
      <Select open>
        <SelectTrigger className="os-trigger">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent className="os-content">
          <SelectGroup>
            <SelectLabel>Group</SelectLabel>
            <SelectItem value="a">A</SelectItem>
            <SelectSeparator />
            <SelectItem value="b">B</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    )

    expect(slot('select-trigger')).toHaveAttribute('data-slot', 'select-trigger')
    expect(slot('select-content')).toHaveAttribute('data-slot', 'select-content')
    expect(slot('select-viewport')).toHaveAttribute('data-slot', 'select-viewport')
    expect(slot('select-label')).toHaveAttribute('data-slot', 'select-label')
    expect(slot('select-item')).toHaveAttribute('data-slot', 'select-item')
    expect(slot('select-separator')).toHaveAttribute('data-slot', 'select-separator')

    expect(slot('select-content')).toHaveClass('os-content')
  })
})

describe('Popover data-slot contract (browser)', () => {
  it('exposes a stable data-slot on the content and merges className', () => {
    render(
      <Popover open>
        <PopoverTrigger>trigger</PopoverTrigger>
        <PopoverContent className="os-popover rounded-none">body</PopoverContent>
      </Popover>,
    )
    const content = slot('popover-content')
    expect(content).toHaveAttribute('data-slot', 'popover-content')
    expect(content).toHaveClass('os-popover')
    // Default `rounded-md` gives way to the caller's `rounded-none`.
    expect(content).toHaveClass('rounded-none')
    expect(content).not.toHaveClass('rounded-md')
  })
})

describe('Combobox data-slot contract (browser)', () => {
  it('exposes stable data-slot names on every open part', () => {
    render(
      <Combobox open>
        <ComboboxTrigger className="os-trigger">trigger</ComboboxTrigger>
        <ComboboxContent className="os-content">
          <ComboboxSearch placeholder="search" />
          <ComboboxList>
            <ComboboxItem>item</ComboboxItem>
            <ComboboxSeparator />
          </ComboboxList>
          <ComboboxEmpty>none</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>,
    )

    expect(slot('combobox-trigger')).toHaveAttribute('data-slot', 'combobox-trigger')
    expect(slot('combobox-content')).toHaveAttribute('data-slot', 'combobox-content')
    expect(slot('combobox-search')).toHaveAttribute('data-slot', 'combobox-search')
    expect(slot('combobox-list')).toHaveAttribute('data-slot', 'combobox-list')
    expect(slot('combobox-item')).toHaveAttribute('data-slot', 'combobox-item')
    expect(slot('combobox-separator')).toHaveAttribute('data-slot', 'combobox-separator')
    expect(slot('combobox-empty')).toHaveAttribute('data-slot', 'combobox-empty')

    expect(slot('combobox-content')).toHaveClass('os-content')
  })
})

describe('DateTimePicker data-slot contract (browser)', () => {
  it('exposes a stable data-slot on the open picker panel', async () => {
    render(<DateTimePicker placeholder="Pick a date" />)
    // The trigger is a Button; opening it mounts the picker panel in a portal.
    await userEvent.click(requireSlot('button'))
    expect(slot('datetime-picker')).toHaveAttribute('data-slot', 'datetime-picker')
  })
})

describe('plain-CSS override via [data-slot] (no Tailwind pipeline)', () => {
  it('restyles primitives from a plain stylesheet, precompiled styles only', () => {
    // A raw, hand-written stylesheet — no Tailwind, no @apply, no build step.
    // This is exactly what an app that consumes only the package's precompiled
    // CSS would add to restyle a primitive (ADR-0016 stable-selector promise).
    const style = document.createElement('style')
    style.setAttribute('data-test', 'plain-css-override')
    style.textContent = `
      [data-slot="input"] { background-color: rgb(1, 2, 3); }
      [data-slot="table-row"] { background-color: rgb(4, 5, 6); }
    `
    document.head.appendChild(style)

    try {
      render(
        <div>
          <Input />
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>cell</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>,
      )

      const input = requireSlot('input')
      const row = requireSlot('table-row')

      // The plain-CSS rule targeting the stable data-slot selector wins.
      expect(getComputedStyle(input).backgroundColor).toBe('rgb(1, 2, 3)')
      expect(getComputedStyle(row).backgroundColor).toBe('rgb(4, 5, 6)')
    } finally {
      style.remove()
    }
  })
})
