import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Chrome polish (issue #735).
 *
 * The starter-auth config opts the Post list into both chrome-polish features:
 * `ui.navCount` (an access-scoped record count next to the Post nav item) and
 * `ui.avatar` (an initials-avatar label column). The User list is left default —
 * no nav count, text-only label — so each assertion contrasts opted-in chrome
 * against the default. Counts flow through the secured context, so the nav
 * badge always agrees with the access-scoped total shown on the list page.
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

test.describe('Chrome polish', () => {
  test('shows an access-scoped nav count on the opted-in list only', async ({ page }) => {
    const testUser = generateTestUser()
    await signUp(page, testUser)

    const slug = `count-${Date.now()}`
    await createPost(page, { title: 'Count Post', slug })

    // On the Post list page, the nav count badge and the access-scoped total in
    // the page header are both computed through the secured context, so they must
    // agree. This proves the count reflects what the session may see.
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    const postNav = page.locator('[data-slot="nav-link"]', { hasText: 'Post' })
    const navBadge = postNav.locator('[data-slot="nav-count"]')
    await expect(navBadge).toBeVisible()

    const navCount = Number((await navBadge.textContent())?.trim())
    expect(Number.isNaN(navCount)).toBe(false)
    expect(navCount).toBeGreaterThanOrEqual(1)

    // The list page header reports the same access-scoped total ("N items").
    const headerText = await page.locator('[data-slot="page-header"]').innerText()
    const headerTotal = Number(headerText.match(/(\d+)\s+items?/)?.[1])
    expect(navCount).toBe(headerTotal)

    // The default User list opts out — no count badge next to its nav item.
    const userNav = page.locator('[data-slot="nav-link"]', { hasText: 'User' })
    await expect(userNav.locator('[data-slot="nav-count"]')).toHaveCount(0)
  })

  test('renders an avatar label cell on the opted-in list, and text-only on the default list', async ({
    page,
  }) => {
    const testUser = generateTestUser()
    await signUp(page, testUser)

    await createPost(page, { title: 'Avatar Post', slug: `avatar-${Date.now()}` })

    // Post opts into avatars: its label column (title) renders an initials bubble
    // ahead of the emphasized title.
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    const postRow = page.getByRole('row', { name: /Avatar Post/ })
    const avatarCell = postRow.locator('[data-slot="cell-avatar-label"]')
    await expect(avatarCell).toBeVisible()

    const avatar = avatarCell.locator('[data-slot="avatar"]')
    await expect(avatar).toBeVisible()
    // "Avatar Post" → initials "AP", deterministic per row.
    await expect(avatar).toHaveText('AP')
    // The avatar is decorative: it must NOT contribute to the cell's accessible
    // name (the visible label already conveys identity). The title cell is still
    // addressable by exactly its label — the regression the aria bubble caused.
    await expect(avatar).toHaveAttribute('aria-hidden', 'true')
    await expect(postRow.getByRole('cell', { name: 'Avatar Post', exact: true })).toBeVisible()

    // The default User list has no avatar treatment on its label column.
    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')
    const userRow = page.locator('tr', { hasText: testUser.email })
    await expect(userRow).toBeVisible()
    await expect(userRow.locator('[data-slot="cell-avatar-label"]')).toHaveCount(0)
  })
})
