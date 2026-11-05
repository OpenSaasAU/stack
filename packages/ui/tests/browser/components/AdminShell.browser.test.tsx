import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { page } from 'vitest/browser'
import prebuiltStylesheet from '../../../dist/styles/globals.css?raw'
import { AdminShell } from '../../../src/components/AdminShell.js'
import { Table, TableBody, TableCell, TableRow } from '../../../src/primitives/table.js'

vi.mock('next/navigation.js', () => ({
  usePathname: () => '/admin',
}))

function renderShell() {
  const style = document.createElement('style')
  style.textContent = prebuiltStylesheet
  document.head.append(style)
  render(
    <AdminShell sidebar={<nav className="sticky top-0 h-dvh w-64">Sidebar</nav>}>
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
  return style
}

const widthOf = (element: Element) => Math.round(element.getBoundingClientRect().width)

const requireElement = (selector: string) => {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Nothing matches ${selector}`)
  return element
}

// Only the package's prebuilt CSS is loaded, as in an app with no Tailwind of its own.
describe('AdminShell layout under the prebuilt stylesheet', () => {
  let style: HTMLStyleElement

  afterEach(() => {
    cleanup()
    style.remove()
  })

  it.each([320, 375])('gives main the full width at %ipx', async (width) => {
    await page.viewport(width, 667)
    style = renderShell()

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
    style = renderShell()

    expect(widthOf(screen.getByRole('navigation'))).toBe(256)
    expect(widthOf(requireElement('main'))).toBe(768)
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
  })

  it('takes a plain-CSS override on the new slots', async () => {
    await page.viewport(375, 667)
    style = renderShell()
    const override = document.createElement('style')
    override.textContent = '[data-slot="admin-topbar"] { background-color: rgb(1, 2, 3); }'
    document.head.append(override)

    expect(getComputedStyle(requireElement('[data-slot="admin-topbar"]')).backgroundColor).toBe(
      'rgb(1, 2, 3)',
    )

    override.remove()
  })
})
