import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Custom Bulk actions from list config (issue #736).
 *
 * Exercises the whole flow against the real access-controlled context: select
 * rows, invoke a list-specific Bulk action ("Publish", declared in the
 * starter-auth `Post` list's `ui.listView.bulkActions`), and see the outcome
 * status line with the table refreshed to reflect the change. The handler runs
 * each selected id through the secured context, so `isAuthor` update access
 * still applies per row.
 */
test.describe('Custom bulk actions', () => {
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

  test('select rows, run Publish, and see the outcome with the table refreshed', async ({
    page,
  }) => {
    // Unique stamp so a search narrows the (shared) list to exactly these posts.
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const titles = [`Action A ${stamp}`, `Action B ${stamp}`]
    for (let i = 0; i < titles.length; i++) {
      await createPost(page, titles[i], `action-${stamp}-${i}`)
    }

    // Narrow to just these posts; both fit on one page.
    await page.goto(`/admin/post?search=${stamp}&sort=title:asc`)
    await expect(page.getByText(titles[0])).toBeVisible()

    const toolbar = page.getByRole('toolbar', { name: /selection/i })

    // Select the whole visible page.
    await page.getByRole('checkbox', { name: /select all rows on this page/i }).click()
    await expect(toolbar).toContainText('2 selected')

    // The custom action button is present in the selection bar alongside Delete.
    const publish = toolbar.getByRole('button', { name: 'Publish' })
    await expect(publish).toBeVisible()
    await publish.click()

    // Both posts are the author's own → "Published 2 of 2", table refreshed.
    // Target the report by its Slot (it must survive the router.refresh()).
    await expect(page.locator('[data-slot="selection-status"]')).toContainText('Published 2 of 2')

    // The effect is visible: each row's status cell now reads Published. Scope
    // to the table and match the badge text EXACTLY so the `publishedAt` column
    // header ("Published At") is not counted.
    const table = page.getByRole('table')
    await expect(table.getByText('Published', { exact: true })).toHaveCount(2)

    // The selection cleared after the action completed.
    await expect(page.getByRole('toolbar', { name: /selection/i })).toHaveCount(0)
  })
})
