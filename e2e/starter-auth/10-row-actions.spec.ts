import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Row actions (issue #2255): the starter-auth `Post` list's "Publish now" Row
 * action, offered only on a post that is not yet published, run from the row
 * menu against the real access-controlled context.
 */
test.describe('Row actions', () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page, generateTestUser())
  })

  async function createPost(page: Page, title: string, slug: string) {
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.click('text=/create|new/i')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', slug)
    await page.fill('textarea[name="content"]', 'content')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  test('run Publish now from the row menu, then see it no longer offered', async ({ page }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const title = `Row action ${stamp}`
    await createPost(page, title, `row-action-${stamp}`)

    await page.goto(`/admin/post?search=${stamp}`)
    const row = page.getByRole('row', { name: new RegExp(title) })
    await expect(row).toBeVisible()
    await expect(row.locator('[data-slot="row-title-link"]')).toHaveAttribute(
      'href',
      /\/admin\/post\/[^/]+$/,
    )

    const trigger = page.getByRole('button', { name: `Actions for ${title}` })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await trigger.click()
    await page.getByRole('menuitem', { name: 'Publish now' }).click()

    await expect(page.locator('[data-slot="selection-status"]')).toContainText('Post published')
    await expect(page.getByRole('table').getByText('Published', { exact: true })).toHaveCount(1)

    await page.getByRole('button', { name: `Actions for ${title}` }).click()
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Publish now' })).toHaveCount(0)
  })

  test('delete a row from its menu after confirming', async ({ page }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const title = `Row delete ${stamp}`
    await createPost(page, title, `row-delete-${stamp}`)

    await page.goto(`/admin/post?search=${stamp}`)
    await page.getByRole('button', { name: `Actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Delete' }).click()

    await expect(page.locator('[data-slot="selection-status"]')).toContainText(`“${title}” deleted`)
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0)
  })
})
