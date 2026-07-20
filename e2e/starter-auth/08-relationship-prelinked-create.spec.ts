import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Relationship-table pre-linked create drawer (issue #738, ADR-0018).
 *
 * The User item view's `posts` Relationship table offers a "+ Add" control that
 * opens a drawer hosting the Post create form, with the back-reference (`author`)
 * preset to this user and hidden. On submit the post is created THROUGH the
 * secured context (Post's own create access + hooks apply, never User's) already
 * linked to the user, the drawer closes, and the table refreshes with the new
 * row.
 *
 * `slug` is a required Post field that is NOT one of the table's columns
 * (`title`, `status`, `viewCount`) — the acceptance case a drawer (not an inline
 * draft row) exists to serve: the related list's full validation and required
 * fields are enforced.
 */

async function openCurrentUserEditPage(page: Page, email: string) {
  await page.goto('/admin/user')
  await page.waitForLoadState('networkidle')
  await page.locator('tr', { hasText: email }).locator('a:has-text("Edit")').click()
  await page.waitForURL(/\/admin\/user\/[^/]+$/, { timeout: 10000 })
}

function tableByHeading(page: Page, name: string) {
  return page.locator('[data-slot="relationship-table"]', {
    has: page.getByRole('heading', { name, exact: true }),
  })
}

test.describe('Relationship-table pre-linked create drawer', () => {
  test('adds a post pre-linked to the user via the drawer, including a required non-column field', async ({
    page,
  }) => {
    const user = generateTestUser()
    await signUp(page, user)

    await openCurrentUserEditPage(page, user.email)

    const posts = tableByHeading(page, 'Posts')
    await expect(posts).toBeVisible()
    // Starts empty for a fresh user.
    await expect(posts.locator('[data-slot="relationship-table-row"]')).toHaveCount(0)

    // Open the pre-linked create drawer from the Posts table toolbar.
    await posts.locator('[data-slot="relationship-table-add"]').click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()

    // The drawer hosts the FULL Post create form — including `slug`, a required
    // field that is NOT one of the table's columns.
    await expect(drawer.locator('input[name="title"]')).toBeVisible()
    await expect(drawer.locator('input[name="slug"]')).toBeVisible()

    const stamp = `${Date.now()}`
    await drawer.locator('input[name="title"]').fill(`Drawer Post ${stamp}`)
    await drawer.locator('input[name="slug"]').fill(`drawer-post-${stamp}`)
    await drawer.getByRole('button', { name: 'Create' }).click()

    // Success is in-place: the drawer closes and the table refreshes with the row.
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
    await expect(
      posts.locator('[data-slot="relationship-table-row"]', { hasText: `Drawer Post ${stamp}` }),
    ).toBeVisible({ timeout: 10000 })

    // The new post is actually LINKED to this user: reloading the user edit page
    // (the Posts table is scoped to the user's own posts via the `author`
    // back-reference) still shows it.
    await openCurrentUserEditPage(page, user.email)
    await expect(
      tableByHeading(page, 'Posts').locator('[data-slot="relationship-table-row"]', {
        hasText: `Drawer Post ${stamp}`,
      }),
    ).toBeVisible()

    // And the post exists as a real record on the Post list (its unique slug
    // identifies exactly one row).
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(`drawer-post-${stamp}`, { exact: true })).toBeVisible()
  })

  test('the add control is absent on tables the session cannot create on', async ({ page }) => {
    const user = generateTestUser()
    await signUp(page, user)
    await openCurrentUserEditPage(page, user.email)

    // `posts` and `notes` are creatable (create: isSignedIn) → "+ Add" shown.
    await expect(
      tableByHeading(page, 'Posts').locator('[data-slot="relationship-table-add"]'),
    ).toBeVisible()

    // `sessions`/`accounts` are auth lists that ship closed (no create rule, deny
    // by default) → the "+ Add" control is hidden, not just disabled.
    const sessions = tableByHeading(page, 'Sessions')
    if (await sessions.count()) {
      await expect(sessions.locator('[data-slot="relationship-table-add"]')).toHaveCount(0)
    }
  })
})
