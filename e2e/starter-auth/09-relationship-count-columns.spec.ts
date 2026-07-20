import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * To-many relationship COUNT columns in the admin list view (issue #732, part of
 * #728; builds on the #729 cell registry and the #730/#731 filter engine +
 * builder).
 *
 * The User list's `posts` relationship (to-many, `User.posts` ↔ `Post.author`)
 * renders as an access-visible COUNT column. These specs drive the real admin UI
 * to prove:
 *  • the count cell shows the number of related rows the session may see,
 *  • the column header sorts by relation count,
 *  • a count comparison (`posts:>N`) filters via the builder and a shared URL.
 *
 * Posts are auto-authored to the signed-in user (the Post `resolveInput` hook),
 * so a fresh user's `posts` count equals the number of posts it creates.
 */
test.describe('To-many relationship count columns', () => {
  let user: ReturnType<typeof generateTestUser>

  test.beforeEach(async ({ page }) => {
    user = generateTestUser()
    await signUp(page, user)
  })

  async function createPost(page: Page, { title, slug }: { title: string; slug: string }) {
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.click('text=/create|new/i')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', slug)
    await page.fill('textarea[name="content"]', 'Body content for the post.')
    await page.click('button[type="submit"]')
    await page.waitForURL(/admin\/post/, { timeout: 10000 })
  }

  async function createPosts(page: Page, count: number, prefix: string) {
    for (let i = 0; i < count; i++) {
      await createPost(page, { title: `${prefix} ${i}`, slug: `${prefix}-${i}` })
    }
  }

  /** The 0-based index of the table column whose header reads exactly `name`. */
  async function columnIndex(page: Page, name: string): Promise<number> {
    const headers = page.locator('table thead th')
    const total = await headers.count()
    for (let i = 0; i < total; i++) {
      const text = (await headers.nth(i).innerText()).trim()
      if (text === name) return i
    }
    throw new Error(`Column "${name}" not found in the table header`)
  }

  test('shows the access-visible related count in the Posts column', async ({ page }) => {
    await createPosts(page, 3, 'count-display')

    // Isolate this user's row via the unique email (free-text filter), so the
    // assertion is robust to other users in the shared database.
    await page.goto(`/admin/user?search=${encodeURIComponent(user.email)}`)
    await page.waitForLoadState('networkidle')

    const postsIdx = await columnIndex(page, 'Posts')
    const row = page.locator('tbody tr', { hasText: user.email })
    await expect(row).toHaveCount(1)

    // The Posts cell renders the count via the dedicated count-cell slot.
    const postsCell = row.locator('td').nth(postsIdx)
    await expect(postsCell.locator('[data-slot="cell-relationship-count"]')).toHaveText('3')
  })

  test('sorts the list by relation count when the Posts header is clicked', async ({ page }) => {
    // Give this user a distinctive number of posts so the ordering is observable.
    await createPosts(page, 4, 'count-sort')

    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')

    const postsIdx = await columnIndex(page, 'Posts')
    // Not `exact`: after a sort the header's accessible name gains the sort-arrow
    // indicator ("Posts ↑"/"Posts ↓"), so match by substring.
    const header = page.getByRole('columnheader', { name: 'Posts' })
    const postsColumn = () => page.locator('tbody tr').locator(`td:nth-child(${postsIdx + 1})`)

    const columnCounts = async (): Promise<number[]> => {
      const texts = await postsColumn().allInnerTexts()
      return texts.map((t) => Number(t.trim())).filter((n) => Number.isFinite(n))
    }

    // First click → ascending count sort: the column is non-decreasing.
    await header.click()
    await page.waitForURL(/sort=posts(%3A|:)asc/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    const asc = await columnCounts()
    for (let i = 1; i < asc.length; i++) {
      expect(asc[i]).toBeGreaterThanOrEqual(asc[i - 1])
    }

    // Second click → descending count sort: the column is non-increasing, and
    // the top row has the highest count on the page (at least this user's 4).
    await header.click()
    await page.waitForURL(/sort=posts(%3A|:)desc/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    const desc = await columnCounts()
    for (let i = 1; i < desc.length; i++) {
      expect(desc[i]).toBeLessThanOrEqual(desc[i - 1])
    }
    expect(desc[0]).toBeGreaterThanOrEqual(4)
  })

  test('filters by a count comparison via a shared URL (posts:>N)', async ({ page }) => {
    await createPosts(page, 4, 'count-url')

    // `posts:>3` keeps this user (4 > 3)…
    await page.goto('/admin/user?search=posts:%3E3')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(1)

    // …and `posts:>4` excludes it (4 is not > 4). This is self-contained: it
    // asserts only about this user's own row, independent of other users.
    await page.goto('/admin/user?search=posts:%3E4')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(0)
  })

  test('filters by a count comparison built in the Filter builder', async ({ page }) => {
    await createPosts(page, 4, 'count-builder')

    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')

    // Build `posts > 3` with the structured row: field Posts, operator greater
    // than, value 3.
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByLabel('Filter field').selectOption('posts')
    await page.getByLabel('Filter operator').selectOption('gt')
    await page.getByLabel('Filter value').fill('3')
    await page.getByRole('button', { name: 'Apply' }).click()

    // The builder writes the engine's grammar (`posts:>3`) into ?search=.
    await page.waitForURL(/search=posts(%3A|:)(%3E|>)3/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(1)
  })
})
