import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Item view layout (issue #734).
 *
 * The record edit page derives its layout from the list's shape: a User has one
 * to-many relationship (`posts`) so its edit page is a two-column split — a
 * details card beside a read-only Relationship table of the user's posts, with
 * a totals footer (row count + summed `viewCount`). A Post has no to-many
 * relationship, so its edit page is a single details card (no Relationship
 * table). Rows shown come through the secured context, so only access-visible
 * data appears.
 */

async function createPost(
  page: Page,
  { title, slug, viewCount }: { title: string; slug: string; viewCount: number },
) {
  await page.goto('/admin/post')
  await page.waitForLoadState('networkidle')
  await page.click('text=/create|new/i')
  await page.waitForLoadState('networkidle')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="slug"]', slug)
  await page.fill('textarea[name="content"]', `${title} content`)
  await page.fill('input[name="viewCount"]', String(viewCount))
  await page.click('button[type="submit"]')
  await page.waitForURL(/admin\/post$/, { timeout: 10000 })
}

test.describe('Item view layout', () => {
  test('renders a Relationship table with a totals footer on the User edit page', async ({
    page,
  }) => {
    const testUser = generateTestUser()
    await signUp(page, testUser)

    // Two posts (auto-authored to the signed-in user) with known view counts.
    await createPost(page, { title: 'View Post A', slug: 'view-post-a', viewCount: 5 })
    await createPost(page, { title: 'View Post B', slug: 'view-post-b', viewCount: 10 })

    // Open the current user's edit page via its row Edit link.
    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')
    await page.locator('tr', { hasText: testUser.email }).locator('a:has-text("Edit")').click()
    await page.waitForURL(/\/admin\/user\/[^/]+$/, { timeout: 10000 })

    // The User has several to-many relationships (posts, sessions, accounts), so
    // the derived layout stacks the Relationship-table sections.
    await expect(page.locator('[data-slot="item-view-layout"]')).toBeVisible()
    await expect(page.locator('[data-slot="relationship-table"]').first()).toBeVisible()

    // The details card still hosts the whole-form Save (unchanged edit behaviour).
    await expect(page.locator('[data-slot="item-view-details"]')).toBeVisible()
    await expect(
      page.locator('[data-slot="item-view-details"] button[type="submit"]'),
    ).toBeVisible()

    // Read-only Relationship table for `posts` (targeted by its heading).
    const table = page.locator('[data-slot="relationship-table"]', {
      has: page.getByRole('heading', { name: 'Posts', exact: true }),
    })
    await expect(table).toBeVisible()

    // Curated columns: title, status, viewCount (the `author` back-reference removed).
    await expect(table.getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'View Count' })).toBeVisible()

    // Both access-visible rows appear.
    await expect(table.getByText('View Post A')).toBeVisible()
    await expect(table.getByText('View Post B')).toBeVisible()

    // Footer: "showing N of M" (issue #752) with M the access-scoped total —
    // here the fetch is under the default cap, so N === M === 2 — plus the
    // summed numeric column (5 + 10 = 15).
    const footer = table.locator('[data-slot="relationship-table-footer"]')
    await expect(footer).toContainText('Showing 2 of 2 rows')
    await expect(footer).toContainText('15')

    // Rows show only access-visible data: the closed Session list (ADR-0013,
    // ungranted here) renders its Relationship table empty rather than leaking.
    const sessions = page.locator('[data-slot="relationship-table"]', {
      has: page.getByRole('heading', { name: 'Sessions', exact: true }),
    })
    await expect(sessions.locator('[data-slot="relationship-table-empty"]')).toBeVisible()
    // Access-scoped M (issue #752): the denied Session list's total is 0, never
    // a leaked true count of the user's sessions.
    await expect(sessions.locator('[data-slot="relationship-table-footer"]')).toContainText(
      'Showing 0 of 0 rows',
    )

    // Secondary note (issue #752): the example curates the auth Account/Session
    // Relationship tables so credential/token columns are NOT surfaced by
    // default. The Account table shows non-sensitive columns only.
    const accounts = page.locator('[data-slot="relationship-table"]', {
      has: page.getByRole('heading', { name: 'Accounts', exact: true }),
    })
    await expect(accounts.getByRole('columnheader', { name: 'Access Token' })).toHaveCount(0)
    await expect(accounts.getByRole('columnheader', { name: 'Refresh Token' })).toHaveCount(0)
    await expect(accounts.getByRole('columnheader', { name: 'Id Token' })).toHaveCount(0)
    await expect(accounts.getByRole('columnheader', { name: 'Provider Id' })).toBeVisible()
    // The Session table likewise omits its `token` column.
    await expect(sessions.getByRole('columnheader', { name: 'Token', exact: true })).toHaveCount(0)
  })

  test('clicking an editable relationship-table cell edits in place instead of navigating', async ({
    page,
  }) => {
    // Inline cell edit (#737) supersedes row-click navigation on EDITABLE cells:
    // a Post's columns are all editable for its author, so clicking one opens the
    // inline editor and the item view stays put (main list tables keep
    // click-to-navigate; this is Relationship-table-only).
    const testUser = generateTestUser()
    await signUp(page, testUser)
    await createPost(page, { title: 'Nav Post', slug: 'nav-post', viewCount: 1 })

    await page.goto('/admin/user')
    await page.waitForLoadState('networkidle')
    await page.locator('tr', { hasText: testUser.email }).locator('a:has-text("Edit")').click()
    await page.waitForURL(/\/admin\/user\/[^/]+$/, { timeout: 10000 })

    const posts = page.locator('[data-slot="relationship-table"]', {
      has: page.getByRole('heading', { name: 'Posts', exact: true }),
    })
    await posts
      .locator('[data-slot="relationship-table-cell-edit-trigger"]', { hasText: 'Nav Post' })
      .click()

    // The inline editor opens and the URL is unchanged (no navigation).
    await expect(posts.locator('[data-slot="relationship-table-cell-editor"] input')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/user\/[^/]+$/)
  })

  test('a list with no to-many relationship renders a single details card', async ({ page }) => {
    const testUser = generateTestUser()
    await signUp(page, testUser)
    await createPost(page, { title: 'Single Card Post', slug: 'single-card-post', viewCount: 2 })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.locator('tr', { hasText: 'Single Card Post' }).locator('a:has-text("Edit")').click()
    await page.waitForURL(/\/admin\/post\/[^/]+$/, { timeout: 10000 })

    // Post has no to-many relationship → no Relationship table, no split layout.
    await expect(page.locator('[data-slot="relationship-table"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="item-view-layout"]')).toHaveCount(0)
    // The details form still renders.
    await expect(page.locator('input[name="title"]')).toHaveValue('Single Card Post')
  })
})
