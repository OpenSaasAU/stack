import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Row selection + built-in Bulk action Delete (issue #733).
 *
 * Exercises the whole flow against the real access-controlled context: select
 * across pages, delete row-by-row through the secured context, and see the
 * "N of M deleted" report with the table refreshed. The list's `Post` delete
 * access is `isAuthor` (a function), so the built-in Delete is offered and the
 * signed-in author can delete their own posts.
 */
test.describe('Bulk delete', () => {
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
    await page.waitForURL(/admin\/post/, { timeout: 10000 })
  }

  test('select across pages, delete, and report N of M with a refreshed table', async ({
    page,
  }) => {
    // Unique stamp so a search narrows the (shared) list to exactly these three
    // posts — signed-in query access shows every author's posts, so pagination
    // counts must not depend on the whole table.
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const titles = [`Bulk A ${stamp}`, `Bulk B ${stamp}`, `Bulk C ${stamp}`]
    for (let i = 0; i < titles.length; i++) {
      await createPost(page, titles[i], `bulk-${stamp}-${i}`)
    }

    // Narrow to these three via search, two per page → page 1 has two, page 2
    // has one. The search (the filter) is kept across page nav, so the selection
    // persists.
    await page.goto(`/admin/post?search=${stamp}&pageSize=2`)
    await page.waitForLoadState('networkidle')

    const toolbar = page.getByRole('toolbar', { name: /selection/i })

    // Page 1: header checkbox toggles the visible page → two selected.
    await page.getByRole('checkbox', { name: /select all rows on this page/i }).click()
    await expect(toolbar).toContainText('2 selected')

    // Page 2: the page-1 selection persists across the navigation…
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForLoadState('networkidle')
    await expect(toolbar).toContainText('2 selected')

    // …and adding the remaining row accumulates to three.
    await page.getByRole('checkbox', { name: /select all rows on this page/i }).click()
    await expect(toolbar).toContainText('3 selected')

    // Confirm and delete.
    await toolbar.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    // All three were the author's own → "3 of 3 deleted", table refreshed.
    await expect(page.getByRole('status')).toContainText('3 of 3 deleted')
    for (const title of titles) {
      await expect(page.getByText(title)).toHaveCount(0)
    }
  })
})
