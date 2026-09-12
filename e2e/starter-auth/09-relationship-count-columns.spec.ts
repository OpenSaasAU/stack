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
 *  • the column header is not a sort control — a to-many count is not a column
 *    the engine can order by (ADR-0055),
 *  • a presence filter (`posts:>0`, `posts:0`) filters via the builder and a
 *    shared URL; any other count comparison degrades to free text (ADR-0055).
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
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  async function createPosts(page: Page, count: number, prefix: string) {
    // Derive the slug from the per-attempt test user (its email is already
    // unique per attempt, including Playwright retries — see generateTestUser),
    // not just the fixed `prefix`. Post.slug is globally unique, so a retry
    // that reused the first attempt's slugs would collide with rows the first
    // attempt already wrote and end up asserting against its own empty state.
    const uniquePrefix = `${prefix}-${user.email.split('@')[0]}`
    for (let i = 0; i < count; i++) {
      await createPost(page, { title: `${prefix} ${i}`, slug: `${uniquePrefix}-${i}` })
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

  test('the Posts header is not a sort control', async ({ page }) => {
    await createPosts(page, 2, 'count-sort')

    // Scoped to this user's row by its unique email, as the count test above
    // is: the shared database holds more users than one page shows.
    await page.goto(`/admin/user?search=${encodeURIComponent(user.email)}`)
    await page.waitForLoadState('networkidle')

    const postsIdx = await columnIndex(page, 'Posts')
    const header = page.locator('table thead th').nth(postsIdx)
    await expect(header).not.toHaveClass(/cursor-pointer/)

    // Clicking it neither writes a sort into the URL nor disturbs the rows.
    await header.click()
    await page.waitForLoadState('networkidle')
    expect(page.url()).not.toMatch(/sort=posts/)
    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(1)
  })

  test('filters by presence via a shared URL (posts:>0 and posts:0)', async ({ page }) => {
    await createPosts(page, 2, 'count-url')

    // `posts:>0` keeps this user (it has posts)…
    await page.goto('/admin/user?search=posts:%3E0')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(1)

    // …and `posts:0` excludes it. This is self-contained: it asserts only
    // about this user's own row, independent of other users.
    await page.goto('/admin/user?search=posts:0')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(0)
  })

  test('filters by presence built in the Filter builder', async ({ page }) => {
    await createPosts(page, 2, 'count-builder')

    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')

    // Build `posts > 0` with the structured row: field Posts, operator greater
    // than, value 0 — the one comparison the engine lowers to `some`.
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByLabel('Filter field').selectOption('posts')
    await page.getByLabel('Filter operator').selectOption('gt')
    await page.getByLabel('Filter value').fill('0')
    await page.getByRole('button', { name: 'Apply' }).click()

    // The builder writes the engine's grammar (`posts:>0`) into ?search=.
    await page.waitForURL(/search=posts(%3A|:)(%3E|>)0/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    await expect(page.locator('tbody tr', { hasText: user.email })).toHaveCount(1)
  })
})
