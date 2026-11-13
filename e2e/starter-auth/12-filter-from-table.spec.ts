import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Filtering from the table (issue #2257): header and value funnels, the
 * auto-shown column of a filtered field, and the zero-results empty state that
 * names the filter to remove.
 */
test.describe('Filter from the table', () => {
  async function createPost(page: Page, title: string, slug: string) {
    await page.goto('/admin/post/create')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', slug)
    await page.fill('textarea[name="content"]', 'content')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  const rowTitles = (page: Page) => page.locator('[data-slot="row-title-link"]')
  const search = (page: Page) => new URL(page.url()).searchParams.get('search')

  test('funnels build a query from the table, and an empty result names the filter to remove', async ({
    page,
  }) => {
    const stamp = `funnel${Date.now()}${Math.floor(Math.random() * 1000)}`
    const name = `Funnel Ada ${stamp}`
    await signUp(page, generateTestUser(name))
    await createPost(page, `Alpha ${stamp}`, `alpha-${stamp}`)
    await createPost(page, `Beta ${stamp}`, `beta-${stamp}`)

    await page.goto(`/admin/post?search=${stamp}`)
    await expect(rowTitles(page)).toHaveCount(2)

    await page.getByRole('button', { name: 'Filter to Status is Draft' }).first().click()
    await page.waitForURL((url) => url.searchParams.get('search') === `${stamp} status:draft`)
    await expect(rowTitles(page)).toHaveCount(2)

    await page
      .getByRole('button', { name: `Filter to Author is ${name}` })
      .first()
      .click()
    await page.waitForURL((url) => /author:#\S+$/.test(url.searchParams.get('search') ?? ''))
    await expect(rowTitles(page)).toHaveCount(2)
    await expect(page.getByRole('group', { name: `Author is ${name}` })).toBeVisible()

    await page.getByRole('button', { name: 'Filter by View Count' }).click()
    const bar = page.getByRole('combobox', { name: 'Filter post' })
    await expect(bar).toBeFocused()
    await expect(page.locator('[data-slot="filter-builder-draft"]')).toContainText('View Count')
    await bar.fill('>999999')
    await bar.press('Enter')
    await page.waitForURL((url) => (url.searchParams.get('search') ?? '').endsWith('>999999'))

    const remove = page.getByRole('button', {
      name: /^Remove “View Count greater than 999,?999” to see 2 rows$/,
    })
    await expect(remove).toBeVisible()
    await remove.click()
    await page.waitForURL((url) => !(url.searchParams.get('search') ?? '').includes('viewCount'))
    expect(search(page)).toMatch(new RegExp(`^${stamp} status:draft author:#\\S+$`))
    await expect(rowTitles(page)).toHaveCount(2)
  })

  test('a filtered field’s column appears without touching ?columns=', async ({ page }) => {
    const stamp = `column${Date.now()}${Math.floor(Math.random() * 1000)}`
    await signUp(page, generateTestUser(`Column Ada ${stamp}`))
    await createPost(page, `Gamma ${stamp}`, `gamma-${stamp}`)

    await page.goto(
      `/admin/post?columns=title&search=${encodeURIComponent(`${stamp} status:draft`)}`,
    )
    await expect(rowTitles(page)).toHaveCount(1)
    await expect(page.getByRole('columnheader', { name: /^Status/ })).toBeVisible()

    await page.getByRole('button', { name: 'Columns' }).click()
    const status = page.getByRole('menuitemcheckbox', { name: 'Status' })
    await expect(status).toHaveAttribute('aria-checked', 'true')
    await expect(status).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    expect(new URL(page.url()).searchParams.get('columns')).toBe('title')
  })

  test('when no single filter helps, the empty state offers Clear filters', async ({ page }) => {
    const stamp = `nohelp${Date.now()}${Math.floor(Math.random() * 1000)}`
    await signUp(page, generateTestUser(`Nohelp Ada ${stamp}`))
    await createPost(page, `Delta ${stamp}`, `delta-${stamp}`)

    await page.goto(
      `/admin/post?search=${encodeURIComponent(`${stamp} viewCount:>999999 status:published`)}`,
    )
    await expect(page.getByText('No matches found')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Remove “/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.waitForURL((url) => !url.searchParams.has('search'))
  })
})
