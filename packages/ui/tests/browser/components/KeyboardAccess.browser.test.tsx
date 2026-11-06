import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'
import prebuiltStylesheet from '../../../dist/styles/globals.css?raw'
import { AdminFrame } from '../../../src/components/AdminFrame.js'
import { AdminShell } from '../../../src/components/AdminShell.js'
import { ItemFormClient } from '../../../src/components/ItemFormClient.js'
import { RelationshipCreateDrawer } from '../../../src/components/RelationshipCreateDrawer.js'
import { ComboboxField } from '../../../src/components/fields/ComboboxField.js'
import { Dialog, DialogContent, DialogTitle } from '../../../src/primitives/dialog.js'
import type { SerializableFieldConfig } from '../../../src/lib/serializeFieldConfig.js'

vi.mock('next/navigation.js', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/link.js', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}))

vi.mock('next/image.js', () => ({ default: () => null }))

vi.mock('@opensaas/stack-core', () => ({ getUrlKey: (listKey: string) => listKey }))

const items = Array.from({ length: 40 }, (_, index) => ({
  id: `t${index}`,
  label: `Tag ${index}`,
}))

function requireActiveOption(): HTMLElement {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant')
  const option = id ? document.getElementById(id) : null
  if (!option) throw new Error('No active option')
  return option
}

describe('keyboard access under the prebuilt stylesheet', () => {
  let style: HTMLStyleElement

  beforeEach(async () => {
    style = document.createElement('style')
    style.textContent = prebuiltStylesheet
    document.head.append(style)
    await page.viewport(1024, 768)
  })

  afterEach(() => {
    cleanup()
    style.remove()
    window.scrollTo(0, 0)
  })

  it('scrolls the active option into the list, leaving the page where it was', async () => {
    render(
      <div style={{ paddingTop: 300, height: 3000 }}>
        <ComboboxField name="tag" value={null} onChange={() => {}} label="Tag" items={items} />
      </div>,
    )
    window.scrollTo(0, 200)

    screen.getByRole('button', { name: /^Tag/ }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
    await userEvent.keyboard('{End}')

    await waitFor(() => expect(requireActiveOption()).toHaveTextContent('Tag 39'))
    const option = requireActiveOption().getBoundingClientRect()
    const list = screen.getByRole('listbox').getBoundingClientRect()
    expect(option.bottom).toBeLessThanOrEqual(list.bottom + 1)
    expect(option.top).toBeGreaterThanOrEqual(list.top)
    expect(window.scrollY).toBe(200)
  })

  it('works inside a modal dialog, where Escape closes only the picker', async () => {
    const onChange = vi.fn()
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Add Post</DialogTitle>
          <ComboboxField name="tag" value={null} onChange={onChange} label="Tag" items={items} />
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: /^Tag/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Add Post' })).toBeVisible()

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('t1')
  })

  it('returns focus to the button that opened the create drawer', async () => {
    render(
      <RelationshipCreateDrawer
        relatedListKey="Post"
        title="Post"
        fields={{ title: { type: 'text' } }}
        parentId="u1"
        basePath="/admin"
        serverAction={vi.fn()}
      />,
    )

    const add = screen.getByRole('button', { name: '+ Add Post' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(add).toHaveFocus())
  })

  it.each([
    [1024, 'the sidebar layout'],
    [375, 'the top bar layout'],
  ])('shows the skip link only on focus, and it moves focus to main, at %ipx', async (width) => {
    await page.viewport(width, 667)
    render(
      <AdminShell sidebar={<nav>Sidebar</nav>}>
        <p>Content</p>
      </AdminShell>,
    )

    const link = screen.getByRole('link', { name: 'Skip to main content' })
    expect(link.getBoundingClientRect().width).toBeLessThanOrEqual(1)

    link.focus()
    const { left, top, right, bottom, width: shown } = link.getBoundingClientRect()
    expect(shown).toBeGreaterThan(100)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(window.innerWidth)
    const topmost = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    expect(topmost).toBe(link)

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    history.replaceState(null, '', location.pathname + location.search)
  })

  describe('after a failed submit on a long form', () => {
    const fields: Record<string, SerializableFieldConfig> = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`field${index}`, { type: 'text' }]),
    )

    function LongForm({ result }: { result: unknown }) {
      return (
        <AdminFrame topBar={<span>Bar</span>}>
          <ItemFormClient
            listKey="Post"
            urlKey="post"
            mode="create"
            fields={fields}
            basePath="/admin"
            serverAction={async () => result}
          />
        </AdminFrame>
      )
    }

    function expectClearOfTopBar(element: Element) {
      const bar = document.querySelector('[data-slot="admin-topbar"]')
      if (!bar) throw new Error('No top bar')
      const { top, bottom } = element.getBoundingClientRect()
      expect(top).toBeGreaterThanOrEqual(bar.getBoundingClientRect().bottom)
      expect(bottom).toBeLessThanOrEqual(window.innerHeight)
    }

    async function submitFromTheBottom() {
      await page.viewport(375, 667)
      const create = screen.getByRole('button', { name: 'Create' })
      create.focus()
      expect(window.scrollY).toBeGreaterThan(500)
      await userEvent.keyboard('{Enter}')
    }

    it('brings the first field with an error into view, under the top bar', async () => {
      render(
        <LongForm
          result={{
            success: false,
            error: 'Failed',
            fieldErrors: { field2: 'Bad', field20: 'Also bad' },
          }}
        />,
      )

      await submitFromTheBottom()

      const field = screen.getByLabelText('Field2')
      await waitFor(() => expect(field).toHaveFocus())
      expectClearOfTopBar(field)
    })

    it('brings the banner into view when no field holds the error', async () => {
      render(<LongForm result={{ success: false, error: 'Failed' }} />)

      await submitFromTheBottom()

      const banner = await screen.findByRole('alert')
      await waitFor(() => expect(banner).toHaveFocus())
      expectClearOfTopBar(banner)
    })
  })
})
