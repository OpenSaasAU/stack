import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { Input } from '../../src/primitives/input.js'
import { Textarea } from '../../src/primitives/textarea.js'
import { Label } from '../../src/primitives/label.js'
import { Checkbox } from '../../src/primitives/checkbox.js'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../../src/primitives/card.js'
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '../../src/primitives/table.js'
import { DialogHeader, DialogFooter } from '../../src/primitives/dialog.js'
import { Select, SelectTrigger, SelectValue } from '../../src/primitives/select.js'
import { Combobox, ComboboxTrigger } from '../../src/primitives/combobox.js'
import { Calendar } from '../../src/primitives/calendar.js'
import { TimePicker } from '../../src/primitives/time-picker.js'

/**
 * Contract test suite for the `data-slot` public compatibility promise
 * (issue #708, ADR-0016). Each primitive and composite part must expose a
 * stable `data-slot` name and merge a caller `className` via tailwind-merge so
 * that instance overrides win. These tests assert external behaviour only —
 * the rendered DOM node's `data-slot` attribute and its resolved class list —
 * never internal component structure.
 *
 * Portalled / open-state parts (Dialog content, Select content, Popover /
 * Combobox content, and the plain-CSS override demonstration) are covered by
 * the browser-mode suite in `tests/browser/primitives/data-slot.browser.test.tsx`.
 */

type Case = {
  /** Documented, stable data-slot name (the public contract). */
  slot: string
  /** Render the component with the given className applied to this slot. */
  render: (className: string) => ReactElement
  /** A default utility on the slot that a same-group override must replace. */
  defaultClass?: string
  /** A caller override in the same utility group as `defaultClass`. */
  overrideClass?: string
  /**
   * Structural parts (the checkbox indicator, the table scroll container) carry
   * a stable data-slot for plain-CSS targeting but are not independently
   * rendered with their own `className` prop — only their attribute is asserted.
   */
  slotOnly?: boolean
}

const cases: Case[] = [
  {
    slot: 'input',
    render: (c) => <Input className={c} />,
    defaultClass: 'px-3',
    overrideClass: 'px-8',
  },
  {
    slot: 'textarea',
    render: (c) => <Textarea className={c} />,
    defaultClass: 'px-3',
    overrideClass: 'px-8',
  },
  {
    slot: 'label',
    render: (c) => <Label className={c}>Name</Label>,
    defaultClass: 'text-sm',
    overrideClass: 'text-2xl',
  },
  {
    slot: 'checkbox',
    render: (c) => <Checkbox className={c} defaultChecked />,
    defaultClass: 'h-4',
    overrideClass: 'h-8',
  },
  {
    slot: 'checkbox-indicator',
    render: () => <Checkbox defaultChecked />,
    slotOnly: true,
  },
  {
    slot: 'card',
    render: (c) => <Card className={c} />,
    defaultClass: 'rounded-lg',
    overrideClass: 'rounded-none',
  },
  {
    slot: 'card-header',
    render: (c) => (
      <Card>
        <CardHeader className={c} />
      </Card>
    ),
    defaultClass: 'p-6',
    overrideClass: 'p-2',
  },
  {
    slot: 'card-title',
    render: (c) => (
      <Card>
        <CardTitle className={c}>Title</CardTitle>
      </Card>
    ),
    defaultClass: 'text-2xl',
    overrideClass: 'text-base',
  },
  {
    slot: 'card-description',
    render: (c) => (
      <Card>
        <CardDescription className={c}>Desc</CardDescription>
      </Card>
    ),
    defaultClass: 'text-sm',
    overrideClass: 'text-lg',
  },
  {
    slot: 'card-content',
    render: (c) => (
      <Card>
        <CardContent className={c}>Body</CardContent>
      </Card>
    ),
    defaultClass: 'p-6',
    overrideClass: 'p-2',
  },
  {
    slot: 'card-footer',
    render: (c) => (
      <Card>
        <CardFooter className={c}>Footer</CardFooter>
      </Card>
    ),
    defaultClass: 'p-6',
    overrideClass: 'p-2',
  },
  {
    slot: 'table-container',
    render: () => (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    slotOnly: true,
  },
  {
    slot: 'table',
    render: (c) => (
      <Table className={c}>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    defaultClass: 'text-sm',
    overrideClass: 'text-lg',
  },
  {
    slot: 'table-header',
    render: (c) => (
      <Table>
        <TableHeader className={c}>
          <TableRow>
            <TableHead>head</TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    ),
  },
  {
    slot: 'table-body',
    render: (c) => (
      <Table>
        <TableBody className={c}>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
  },
  {
    slot: 'table-footer',
    render: (c) => (
      <Table>
        <TableFooter className={c}>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    ),
    defaultClass: 'bg-muted/50',
    overrideClass: 'bg-transparent',
  },
  {
    slot: 'table-row',
    render: (c) => (
      <Table>
        <TableBody>
          <TableRow className={c}>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    defaultClass: 'border-b',
    overrideClass: 'border-0',
  },
  {
    slot: 'table-head',
    render: (c) => (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={c}>head</TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    ),
    defaultClass: 'px-4',
    overrideClass: 'px-8',
  },
  {
    slot: 'table-cell',
    render: (c) => (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className={c}>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    defaultClass: 'p-4',
    overrideClass: 'p-8',
  },
  {
    slot: 'table-caption',
    render: (c) => (
      <Table>
        <TableCaption className={c}>caption</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
    defaultClass: 'mt-4',
    overrideClass: 'mt-8',
  },
  {
    slot: 'dialog-header',
    render: (c) => <DialogHeader className={c} />,
    defaultClass: 'text-center',
    overrideClass: 'text-left',
  },
  {
    slot: 'dialog-footer',
    render: (c) => <DialogFooter className={c} />,
    defaultClass: 'flex-col-reverse',
    overrideClass: 'flex-row',
  },
  {
    slot: 'select-trigger',
    render: (c) => (
      <Select>
        <SelectTrigger className={c}>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
      </Select>
    ),
    defaultClass: 'px-3',
    overrideClass: 'px-8',
  },
  {
    slot: 'combobox-trigger',
    render: (c) => (
      <Combobox>
        <ComboboxTrigger className={c}>Pick</ComboboxTrigger>
      </Combobox>
    ),
    defaultClass: 'px-3',
    overrideClass: 'px-8',
  },
  {
    slot: 'calendar',
    render: (c) => <Calendar className={c} />,
    defaultClass: 'p-3',
    overrideClass: 'p-8',
  },
  {
    slot: 'time-picker',
    render: (c) => <TimePicker className={c} />,
    defaultClass: 'gap-2',
    overrideClass: 'gap-8',
  },
]

describe('primitive data-slot contract (happy-dom)', () => {
  for (const { slot, render: renderCase, defaultClass, overrideClass, slotOnly } of cases) {
    describe(`data-slot="${slot}"`, () => {
      it('carries the stable data-slot attribute', () => {
        const { container } = render(renderCase('os-marker'))
        const node = container.querySelector(`[data-slot="${slot}"]`)
        expect(node).not.toBeNull()
        expect(node).toHaveAttribute('data-slot', slot)
      })

      if (!slotOnly) {
        it('merges a caller className onto the slot', () => {
          const { container } = render(renderCase('os-custom-class'))
          const node = container.querySelector(`[data-slot="${slot}"]`)
          expect(node).toHaveClass('os-custom-class')
        })
      }

      if (defaultClass && overrideClass) {
        it('lets a caller className override a default (tailwind-merge)', () => {
          const withDefault = render(renderCase('unrelated-marker'))
          const defaultNode = withDefault.container.querySelector(`[data-slot="${slot}"]`)
          // Sanity: the default utility is present when not overridden.
          expect(defaultNode).toHaveClass(defaultClass)

          const withOverride = render(renderCase(overrideClass))
          const overriddenNode = withOverride.container.querySelector(`[data-slot="${slot}"]`)
          expect(overriddenNode).toHaveClass(overrideClass)
          // tailwind-merge drops the same-group default so the override wins.
          expect(overriddenNode).not.toHaveClass(defaultClass)
        })
      }
    })
  }
})
