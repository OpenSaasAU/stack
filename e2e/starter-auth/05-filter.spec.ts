import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Filter engine (issue #730 / ADR-0017).
 *
 * A URL-typed filter query narrows the list server-side through the secured
 * context: field-scoped tokens, bare-word free text, and graceful degradation
 * of unknown syntax. These specs type the query into the URL (`?search=`) — the
 * same param the Filter builder input writes — and assert the table shows
 * exactly the matching, access-scoped rows.
 */
test.describe('List filtering (URL-driven, server-side)', () => {
  let testUser: ReturnType<typeof generateTestUser>

  test.beforeEach(async ({ page }) => {
    testUser = generateTestUser()
    await signUp(page, testUser)
  })

  // Content is a fixed string that never collides with a post title, so a cell
  // selector for a title matches the title column only.
  async function createPost(
    page: Page,
    { title, slug, status }: { title: string; slug: string; status: 'draft' | 'published' },
  ) {
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.click('text=/create|new/i')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', slug)
    await page.fill('textarea[name="content"]', 'Body content for the post.')
    if (status === 'published') {
      await page.getByLabel('Status').click()
      await page.getByRole('option', { name: 'published' }).click()
    }
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  /** A table cell whose exact text is the given title (the title column). */
  function titleCell(page: Page, title: string) {
    return page.getByRole('cell', { name: title, exact: true })
  }

  test('bare-word free text narrows the table to matching rows', async ({ page }) => {
    await createPost(page, { title: 'Apples are red', slug: 'apples', status: 'published' })
    await createPost(page, { title: 'Bananas are yellow', slug: 'bananas', status: 'published' })

    // Free-text query typed into the URL.
    await page.goto('/admin/post?search=Apples')
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Apples are red')).toBeVisible()
    await expect(titleCell(page, 'Bananas are yellow')).toHaveCount(0)
  })

  test('a field-scoped select token filters by status', async ({ page }) => {
    await createPost(page, { title: 'Draft One', slug: 'draft-one', status: 'draft' })
    await createPost(page, { title: 'Published One', slug: 'published-one', status: 'published' })

    // `status:Published` — matched against the select option label/value.
    await page.goto('/admin/post?search=status%3APublished')
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Published One')).toBeVisible()
    await expect(titleCell(page, 'Draft One')).toHaveCount(0)
  })

  test('unknown syntax degrades to free text and never errors', async ({ page }) => {
    await createPost(page, { title: 'Findable Title', slug: 'findable', status: 'published' })

    // `nosuchfield:Findable` — the field has no Filter spec, so the token
    // degrades to a free-text search for "Findable" rather than 500-ing.
    await page.goto('/admin/post?search=nosuchfield%3AFindable')
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Findable Title')).toBeVisible()
  })
})
