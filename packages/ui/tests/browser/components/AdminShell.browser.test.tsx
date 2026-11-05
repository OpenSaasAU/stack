import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { page } from 'vitest/browser'
import prebuiltStylesheet from '../../../dist/styles/globals.css?raw'
import { AdminShell } from '../../../src/components/AdminShell.js'
import { AdminLoading } from '../../../src/components/SkeletonLoader.js'
import { STICKY_ACTIONS_CELL } from '../../../src/lib/tableClasses.js'
import { cn } from '../../../src/lib/utils.js'
import { Checkbox } from '../../../src/primitives/checkbox.js'
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../../../src/primitives/combobox.js'
import { Dialog, DialogContent, DialogTitle } from '../../../src/primitives/dialog.js'
import { Popover, PopoverContent, PopoverTrigger } from '../../../src/primitives/popover.js'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../src/primitives/select.js'
import { Table, TableBody, TableCell, TableRow } from '../../../src/primitives/table.js'

vi.mock('next/navigation.js', () => ({
  usePathname: () => '/admin',
}))

const sidebar = <nav className="sticky top-0 h-dvh w-64">Sidebar</nav>

const widthOf = (element: Element) => Math.round(element.getBoundingClientRect().width)

const requireElement = (selector: string) => {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Nothing matches ${selector}`)
  return element
}

const requireInput = () => {
  const input = document.querySelector('input')
  if (!input) throw new Error('No input rendered')
  return input
}

function expectInsideViewport(element: Element) {
  const { top, bottom, left, right } = element.getBoundingClientRect()
  expect(top).toBeGreaterThanOrEqual(0)
  expect(left).toBeGreaterThanOrEqual(0)
  expect(bottom).toBeLessThanOrEqual(window.innerHeight)
  expect(right).toBeLessThanOrEqual(window.innerWidth)
}

// Only the package's prebuilt CSS is loaded, as in an app with no Tailwind of its own.
describe('the admin under the prebuilt stylesheet', () => {
  let style: HTMLStyleElement

  beforeEach(() => {
    style = document.createElement('style')
    style.textContent = prebuiltStylesheet
    document.head.append(style)
  })

  afterEach(() => {
    cleanup()
    style.remove()
    window.scrollTo(0, 0)
  })

  describe('AdminShell layout', () => {
    const renderWideTable = () =>
      render(
        <AdminShell sidebar={sidebar}>
          <div className="p-4 md:p-8">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>{'unbroken'.repeat(60)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </AdminShell>,
      )

    it.each([320, 375])('gives main the full width at %ipx', async (width) => {
      await page.viewport(width, 667)
      renderWideTable()

      const main = requireElement('main')
      const container = requireElement('[data-slot="table-container"]')

      expect(widthOf(main)).toBe(width)
      expect(main.scrollWidth).toBe(main.clientWidth)
      expect(document.documentElement.scrollWidth).toBe(width)
      expect(container.scrollWidth).toBeGreaterThan(container.clientWidth)
      expect(screen.getByRole('button', { name: 'Open navigation' })).toBeVisible()
      expect(screen.queryByRole('navigation')).toBeNull()
    })

    it('keeps the sidebar in the page flow from md up, with no top bar', async () => {
      await page.viewport(1024, 768)
      renderWideTable()

      expect(widthOf(screen.getByRole('navigation'))).toBe(256)
      expect(widthOf(requireElement('main'))).toBe(768)
      expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    })

    it('takes a plain-CSS override on the new slots', async () => {
      await page.viewport(375, 667)
      renderWideTable()
      const override = document.createElement('style')
      override.textContent = '[data-slot="admin-topbar"] { background-color: rgb(1, 2, 3); }'
      document.head.append(override)

      expect(getComputedStyle(requireElement('[data-slot="admin-topbar"]')).backgroundColor).toBe(
        'rgb(1, 2, 3)',
      )

      override.remove()
    })
  })

  describe('AdminLoading', () => {
    it.each([320, 375])('holds the phone layout at %ipx', async (width) => {
      await page.viewport(width, 667)
      render(<AdminLoading />)

      expect(widthOf(requireElement('main'))).toBe(width)
      expect(requireElement('main').getBoundingClientRect().left).toBe(0)
      expect(document.documentElement.scrollWidth).toBe(width)
      expect(requireElement('[data-slot="admin-topbar"]').getBoundingClientRect().height).toBe(56)
    })

    it('keeps its sidebar from md up', async () => {
      await page.viewport(1024, 768)
      render(<AdminLoading />)

      expect(widthOf(requireElement('main'))).toBe(768)
      expect(getComputedStyle(requireElement('[data-slot="admin-topbar"]')).display).toBe('none')
    })
  })

  describe.each([320, 375])('a focused field at %ipx', (width) => {
    const TOP_BAR = 56
    const LABEL = 28

    const renderForm = () =>
      render(
        <AdminShell sidebar={sidebar}>
          <form className="p-4">
            <label className="block" htmlFor="title">
              Title
            </label>
            <input id="title" required className="block h-10 w-full" />
            <div style={{ height: 2000 }} />
            <button type="submit">Create</button>
          </form>
        </AdminShell>,
      )

    const expectClearOfTopBar = async () => {
      const input = requireInput()
      await waitFor(() => expect(input).toHaveFocus())
      await waitFor(() =>
        expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(TOP_BAR + LABEL),
      )
    }

    beforeEach(async () => {
      await page.viewport(width, 568)
    })

    it('clears the top bar when a refused submit focuses it', async () => {
      renderForm()
      window.scrollTo(0, document.documentElement.scrollHeight)

      screen.getByRole('button', { name: 'Create' }).click()

      await expectClearOfTopBar()
    })

    it('clears the top bar when the form focuses its first invalid field', async () => {
      renderForm()
      window.scrollBy(0, requireInput().getBoundingClientRect().top - 10)

      requireInput().focus()

      await expectClearOfTopBar()
    })

    it('clears the top bar when tabbing back up into a textarea', async () => {
      render(
        <AdminShell sidebar={sidebar}>
          <div style={{ height: 600 }} />
          <textarea aria-label="Notes" className="block h-20 w-full" />
          <div style={{ height: 2000 }} />
        </AdminShell>,
      )
      const textarea = screen.getByRole('textbox', { name: 'Notes' })
      window.scrollBy(0, textarea.getBoundingClientRect().top + 12)

      textarea.focus()

      await waitFor(() =>
        expect(textarea.getBoundingClientRect().top).toBeGreaterThanOrEqual(TOP_BAR + LABEL),
      )
    })
  })

  describe('sticky actions cell', () => {
    const renderRow = (rowClass: string) =>
      render(
        <Table>
          <TableBody>
            <TableRow className={rowClass}>
              <TableCell>{'unbroken'.repeat(60)}</TableCell>
              <TableCell
                data-testid="actions"
                className={cn('max-md:before:bg-background', STICKY_ACTIONS_CELL)}
              >
                Edit
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      )

    beforeEach(async () => {
      await page.viewport(375, 667)
    })

    it('stays on screen while the table scrolls under it', () => {
      renderRow('')
      const cell = screen.getByTestId('actions')

      expect(getComputedStyle(cell).position).toBe('sticky')
      expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(375)
    })

    it('shows the row colour over an opaque surface', () => {
      renderRow('[background-color:rgba(15,23,42,0.5)]')
      const cell = screen.getByTestId('actions')

      const surface = getComputedStyle(cell, '::before')
      const tint = getComputedStyle(cell, '::after')

      expect(tint.backgroundColor).toBe('rgba(15, 23, 42, 0.5)')
      expect(tint.position).toBe('absolute')
      expect(surface.backgroundColor).toBe(getComputedStyle(document.body).backgroundColor)
      expect(surface.position).toBe('absolute')
      expect(surface.top).toBe('0px')
      expect(Number(surface.zIndex)).toBeLessThan(0)
    })
  })

  describe('Checkbox on a phone', () => {
    it('takes a tap beyond its box, at whatever size a caller gives it', async () => {
      await page.viewport(375, 667)
      render(<Checkbox aria-label="Row" className="m-8 h-5 w-5" />)
      const checkbox = screen.getByRole('checkbox', { name: 'Row' })
      const { left, top, width } = checkbox.getBoundingClientRect()

      expect(width).toBe(20)
      expect(document.elementFromPoint(left - 6, top - 6)).toBe(checkbox)
    })
  })

  describe('Dialog width', () => {
    const renderDialog = (className?: string) =>
      render(
        <Dialog open>
          <DialogContent className={className} aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>,
      )

    it('fills a phone less its gutter', async () => {
      await page.viewport(375, 667)
      renderDialog()

      expect(widthOf(screen.getByRole('dialog'))).toBe(343)
    })

    it('stays two thirds of the window at md, whatever max-width a caller sets', async () => {
      await page.viewport(768, 800)
      renderDialog('max-w-2xl')

      expect(widthOf(screen.getByRole('dialog'))).toBe(512)
    })
  })

  describe('floating content at 320x568', () => {
    beforeEach(async () => {
      await page.viewport(320, 568)
    })

    it('caps a popover to the height available', async () => {
      render(
        <Popover open>
          <PopoverTrigger style={{ marginTop: 250 }}>Open</PopoverTrigger>
          <PopoverContent>
            <div style={{ height: 1000 }} />
          </PopoverContent>
        </Popover>,
      )

      await waitFor(() => expectInsideViewport(requireElement('[data-slot="popover-content"]')))
    })

    it('keeps a long select on screen', async () => {
      render(
        <div style={{ margin: '250px 32px 0' }}>
          <Select open>
            <SelectTrigger>
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 60 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  Option {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>,
      )

      await waitFor(() => expectInsideViewport(requireElement('[data-slot="select-content"]')))
    })

    it('keeps a combobox of long labels on screen', async () => {
      render(
        <div style={{ marginTop: 250 }}>
          <Combobox open>
            <ComboboxTrigger>Pick</ComboboxTrigger>
            <ComboboxContent>
              <ComboboxList>
                <ComboboxItem>{'unbroken'.repeat(30)}</ComboboxItem>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>,
      )

      await waitFor(() => expectInsideViewport(requireElement('[data-slot="combobox-content"]')))
    })
  })
})
