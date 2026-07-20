import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Relationship-table inline cell edit (issue #737, ADR-0018).
 *
 * The User item view renders a `posts` Relationship table whose cells are
 * inline-editable for the signed-in author (Post's update access is `isAuthor`).
 * Clicking a cell opens an in-place editor; Enter commits a single-field update
 * on the RELATED row through the secured context, so the related list's own
 * access + hooks/validation apply — never the parent's.
 *
 * - Happy path: editing a post's title inline persists (the change is visible on
 *   the Post list, proving it went through the secured context, not just the UI).
 * - Revert path: an edit the related list rejects (a validation hook forbids the
 *   word "spam") reverts the cell to its original value with a visible reason,
 *   and the database is left unchanged.
 */

async function createPost(page: Page, { title, slug }: { title: string; slug: string }) {
  await page.goto('/admin/post')
  await page.waitForLoadState('networkidle')
  await page.click('text=/create|new/i')
  await page.waitForLoadState('networkidle')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="slug"]', slug)
  await page.fill('textarea[name="content"]', `${title} content`)
  await page.click('button[type="submit"]')
  await page.waitForURL(/admin\/post$/, { timeout: 10000 })
}

/**
 * Open the CURRENT user's item view directly by id (resolved from the session),
 * rather than hunting the user's row in the paginated `/admin/user` list — that
 * list caps at 50 rows, so once the suite has signed up enough users the newest
 * one is off page 1 and unfindable.
 */
async function openCurrentUserEditPage(page: Page) {
  const res = await page.request.get('/api/auth/get-session')
  const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null
  const userId = body?.user?.id
  expect(userId, 'current user id resolved from session').toBeTruthy()
  await page.goto(`/admin/user/${userId}`)
  await page.waitForURL(/\/admin\/user\/[^/]+$/, { timeout: 10000 })
  await page.waitForLoadState('networkidle')
}

function postsTable(page: Page) {
  return page.locator('[data-slot="relationship-table"]', {
    has: page.getByRole('heading', { name: 'Posts', exact: true }),
  })
}

test.describe('Relationship-table inline cell edit', () => {
  test('commits a single-field edit through the secured context and persists it', async ({
    page,
  }) => {
    const user = generateTestUser()
    await signUp(page, user)

    const stamp = `${Date.now()}`
    await createPost(page, { title: `Inline ${stamp}`, slug: `inline-${stamp}` })

    await openCurrentUserEditPage(page)
    const posts = postsTable(page)
    await expect(posts).toBeVisible()

    // Click the title cell → inline editor, change the value, commit on Enter.
    await posts
      .locator('[data-slot="relationship-table-cell-edit-trigger"]', { hasText: `Inline ${stamp}` })
      .click()
    const input = posts.locator('[data-slot="relationship-table-cell-editor"] input')
    await input.fill(`Renamed ${stamp}`)
    await input.press('Enter')

    // Optimistic + refresh: the cell now shows the committed value.
    await expect(
      posts.locator('[data-slot="relationship-table-cell-edit-trigger"]', {
        hasText: `Renamed ${stamp}`,
      }),
    ).toBeVisible({ timeout: 10000 })

    // Persisted through the SECURED context — the Post list reflects the change.
    // Filter by the unique slug so the assertion is immune to the list's 50-row
    // page cap as the suite accumulates posts.
    await page.goto(`/admin/post?search=inline-${stamp}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(`Renamed ${stamp}`)).toBeVisible()
    await expect(page.getByText(`Inline ${stamp}`, { exact: true })).toHaveCount(0)
  })

  test('reverts with a visible reason when the related list rejects the edit', async ({ page }) => {
    const user = generateTestUser()
    await signUp(page, user)

    const stamp = `${Date.now()}`
    await createPost(page, { title: `Keepme ${stamp}`, slug: `keepme-${stamp}` })

    await openCurrentUserEditPage(page)
    const posts = postsTable(page)

    // Post's validation hook forbids the word "spam" — the commit fails.
    await posts
      .locator('[data-slot="relationship-table-cell-edit-trigger"]', { hasText: `Keepme ${stamp}` })
      .click()
    const input = posts.locator('[data-slot="relationship-table-cell-editor"] input')
    await input.fill('spam')
    await input.press('Enter')

    // Reverted to the original value with a visible reason (role="alert").
    await expect(posts.getByRole('alert')).toBeVisible({ timeout: 10000 })
    await expect(
      posts.locator('[data-slot="relationship-table-cell-edit-trigger"]', {
        hasText: `Keepme ${stamp}`,
      }),
    ).toBeVisible()

    // The database is unchanged — the Post list still shows the original title.
    await page.goto(`/admin/post?search=keepme-${stamp}`)
    await page.waitForLoadState('networkidle')
    // `exact` avoids matching the content cell ("Keepme … content").
    await expect(page.getByText(`Keepme ${stamp}`, { exact: true })).toBeVisible()
  })
})
