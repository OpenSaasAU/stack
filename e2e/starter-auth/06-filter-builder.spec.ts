import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Filter builder input UI (issue #731, part of #728; layered on the #730 filter
 * engine / ADR-0017).
 *
 * These specs drive the REAL builder in the admin list view — the free-text box
 * and the structured field/operator/value rows — and assert it writes the
 * `?search=` filter query the secured server-side engine consumes, narrowing the
 * table to the matching, access-scoped rows. (05-filter.spec.ts types the query
 * straight into the URL; this exercises the UI that produces it.)
 */
test.describe('Filter builder input UI', () => {
  let testUser: ReturnType<typeof generateTestUser>

  test.beforeEach(async ({ page }) => {
    testUser = generateTestUser()
    await signUp(page, testUser)
  })

  /**
   * Post.slug is unique across the whole database the specs share, and
   * 05-filter.spec.ts creates the same fruit before this file runs, so every
   * slug here is suffixed with the per-attempt user (unique across retries too).
   */
  const slug = (base: string) => `${base}-${testUser.email.split('@')[0]}`

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

  /**
   * The table cells whose exact text is the given title (the title column).
   * 05-filter.spec.ts creates the same titles against the database these specs
   * share, so a visibility assertion takes `.first()` and a count assertion
   * expects zero.
   */
  function titleCell(page: Page, title: string) {
    return page.getByRole('cell', { name: title, exact: true })
  }

  test('free-text box narrows the table and writes ?search=', async ({ page }) => {
    await createPost(page, { title: 'Apples are red', slug: slug('apples'), status: 'published' })
    await createPost(page, {
      title: 'Bananas are yellow',
      slug: slug('bananas'),
      status: 'published',
    })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    // Type into the builder's free-text search box and apply.
    await page.getByLabel('Search').fill('Apples')
    await page.getByRole('button', { name: 'Apply' }).click()

    await page.waitForURL(/search=Apples/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Apples are red').first()).toBeVisible()
    await expect(titleCell(page, 'Bananas are yellow')).toHaveCount(0)
  })

  test('a structured status filter produces a field:value query', async ({ page }) => {
    await createPost(page, { title: 'Draft One', slug: slug('draft-one'), status: 'draft' })
    await createPost(page, {
      title: 'Published One',
      slug: slug('published-one'),
      status: 'published',
    })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    // Add a structured condition, target the `status` field, pick "Published".
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByLabel('Filter field').selectOption('status')
    await page.getByLabel('Filter value').selectOption('published')
    await page.getByRole('button', { name: 'Apply' }).click()

    // The applied query is the engine's grammar (`status:published`), URL-encoded.
    await page.waitForURL(/search=status(%3A|:)published/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Published One').first()).toBeVisible()
    await expect(titleCell(page, 'Draft One')).toHaveCount(0)
  })

  test('Clear removes the filter and restores every row', async ({ page }) => {
    await createPost(page, { title: 'Keep Me', slug: slug('keep-me'), status: 'published' })
    await createPost(page, { title: 'Also Me', slug: slug('also-me'), status: 'published' })

    // Land on an already-filtered view (the builder hydrates from the URL).
    await page.goto('/admin/post?search=Keep')
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, 'Keep Me').first()).toBeVisible()
    await expect(titleCell(page, 'Also Me')).toHaveCount(0)

    // Clearing drops the `?search=` filter and both rows return. `exact` avoids
    // matching the inline "Clear filter text" affordance.
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.waitForLoadState('networkidle')

    await expect(titleCell(page, 'Keep Me').first()).toBeVisible()
    await expect(titleCell(page, 'Also Me').first()).toBeVisible()
  })
})
