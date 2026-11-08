import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Filter builder input UI (issue #731, part of #728; layered on the #730 filter
 * engine / ADR-0017).
 *
 * These specs drive the REAL Filter builder bar in the admin list view (#2249)
 * and assert each committed chip writes the `?search=` filter query the secured
 * server-side engine consumes, narrowing the table to the matching,
 * access-scoped rows. (05-filter.spec.ts types the query
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

  const filterBar = (page: Page) => page.getByRole('combobox', { name: 'Filter post' })

  test('a free-text search becomes a chip, narrows the table and writes ?search=', async ({
    page,
  }) => {
    await createPost(page, { title: 'Apples are red', slug: slug('apples'), status: 'published' })
    await createPost(page, {
      title: 'Bananas are yellow',
      slug: slug('bananas'),
      status: 'published',
    })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    await filterBar(page).fill('Apples')
    await page.getByRole('option', { name: 'Search all text for “Apples”' }).click()

    await page.waitForURL(/search=Apples/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('group', { name: 'Text contains Apples' })).toBeVisible()
    await expect(titleCell(page, 'Apples are red').first()).toBeVisible()
    await expect(titleCell(page, 'Bananas are yellow')).toHaveCount(0)
  })

  test('choosing a field goes straight to its values and applies on commit', async ({ page }) => {
    await createPost(page, { title: 'Draft One', slug: slug('draft-one'), status: 'draft' })
    await createPost(page, {
      title: 'Published One',
      slug: slug('published-one'),
      status: 'published',
    })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    await filterBar(page).click()
    await expect(page.getByRole('option', { name: 'Status', exact: true })).toBeVisible()

    await page.keyboard.type('sta')
    await page.keyboard.press('Enter')
    await page.getByRole('option', { name: 'Published', exact: true }).click()

    await page.waitForURL(/search=status(%3A|:)published/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('group', { name: 'Status is Published' })).toBeVisible()
    await expect(titleCell(page, 'Published One').first()).toBeVisible()
    await expect(titleCell(page, 'Draft One')).toHaveCount(0)
  })

  test('a plain phrase applies as a token, and a second is filter replaces the first', async ({
    page,
  }) => {
    await createPost(page, { title: 'Phrase Draft', slug: slug('phrase-draft'), status: 'draft' })
    await createPost(page, {
      title: 'Phrase Published',
      slug: slug('phrase-published'),
      status: 'published',
    })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    await filterBar(page).fill('status is draft')
    await page.keyboard.press('Enter')
    await page.waitForURL(/search=status(%3A|:)draft/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, 'Phrase Draft').first()).toBeVisible()
    await expect(titleCell(page, 'Phrase Published')).toHaveCount(0)

    await filterBar(page).fill('status is published')
    await page.keyboard.press('Enter')
    await page.waitForURL(/search=status(%3A|:)published(&|$)/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: /^Status is/ })).toHaveCount(1)
    await expect(titleCell(page, 'Phrase Published').first()).toBeVisible()

    await page.goBack()
    await page.waitForURL(/search=status(%3A|:)draft/, { timeout: 10000 })
    await expect(page.getByRole('group', { name: 'Status is Draft' })).toBeVisible()
    await expect(titleCell(page, 'Phrase Draft').first()).toBeVisible()
  })

  test('a filtered URL reproduces its chips, and removing them restores every row', async ({
    page,
  }) => {
    await createPost(page, { title: 'Keep Me', slug: slug('keep-me'), status: 'published' })
    await createPost(page, { title: 'Also Me', slug: slug('also-me'), status: 'published' })

    await page.goto('/admin/post?search=Keep%20status:published')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: 'Text contains Keep' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Status is Published' })).toBeVisible()
    await expect(titleCell(page, 'Keep Me').first()).toBeVisible()
    await expect(titleCell(page, 'Also Me')).toHaveCount(0)

    await page.getByRole('button', { name: 'Remove Text contains Keep' }).click()
    await page.waitForURL(/search=status(%3A|:)published/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, 'Also Me').first()).toBeVisible()

    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.waitForURL((url) => !url.searchParams.has('search'), { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, 'Keep Me').first()).toBeVisible()
    await expect(titleCell(page, 'Also Me').first()).toBeVisible()
  })

  test('/ focuses the bar, and Backspace selects then removes the last chip', async ({ page }) => {
    await page.goto('/admin/post?search=status:draft')
    await page.waitForLoadState('networkidle')

    await filterBar(page).blur()
    await page.keyboard.press('/')
    await expect(filterBar(page)).toBeFocused()

    await page.keyboard.press('Backspace')
    await expect(page.getByRole('group', { name: 'Status is Draft' })).toHaveAttribute(
      'data-armed',
      '',
    )
    await page.keyboard.press('Backspace')
    await page.waitForURL((url) => !url.searchParams.has('search'), { timeout: 10000 })
    await expect(page.getByRole('group', { name: 'Status is Draft' })).toHaveCount(0)
  })

  test('a between phrase writes one range token, and a pasted >= <= pair reads as one chip', async ({
    page,
  }) => {
    await createPost(page, { title: 'Ranged Post', slug: slug('ranged'), status: 'draft' })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await filterBar(page).fill('view count between 0 and 5')
    await page.keyboard.press('Enter')

    await page.waitForURL((url) => url.searchParams.get('search') === 'viewCount:0..5', {
      timeout: 10000,
    })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: 'View Count between 0 and 5' })).toBeVisible()
    await expect(titleCell(page, 'Ranged Post').first()).toBeVisible()

    await page.goto('/admin/post?search=viewCount:>=1%20viewCount:<=5')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: 'View Count between 1 and 5' })).toBeVisible()
    await expect(titleCell(page, 'Ranged Post')).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('search')).toBe('viewCount:>=1 viewCount:<=5')
  })
})
