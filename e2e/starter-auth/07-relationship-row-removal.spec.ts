import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Relationship-table row removal (issue #739, ADR-0018).
 *
 * The User item view renders two to-many Relationship tables with different
 * removal semantics:
 * - `posts` (default `disconnect`): the ✕ unlinks the post from the user. The
 *   post itself survives and still appears on the Post list.
 * - `notes` (opt-in `delete`): the ✕ confirms, then truly deletes the note.
 *
 * Both removals run through the secured context, so they respect the related
 * list's own access control.
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

async function createNote(page: Page, body: string) {
  await page.goto('/admin/note')
  await page.waitForLoadState('networkidle')
  await page.click('text=/create|new/i')
  await page.waitForLoadState('networkidle')
  await page.fill('textarea[name="body"]', body)
  await page.click('button[type="submit"]')
  await page.waitForURL(/admin\/note$/, { timeout: 10000 })
}

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

test.describe('Relationship-table row removal', () => {
  test('default ✕ disconnects a post (the post still exists)', async ({ page }) => {
    const user = generateTestUser()
    await signUp(page, user)

    const stamp = `${Date.now()}`
    await createPost(page, { title: `Keep ${stamp}`, slug: `keep-${stamp}` })
    await createPost(page, { title: `Drop ${stamp}`, slug: `drop-${stamp}` })

    await openCurrentUserEditPage(page, user.email)

    const posts = tableByHeading(page, 'Posts')
    await expect(posts).toBeVisible()
    const dropRow = posts.locator('[data-slot="relationship-table-row"]', {
      hasText: `Drop ${stamp}`,
    })
    await expect(dropRow).toBeVisible()

    // Disconnect: no confirmation, non-destructive.
    await dropRow.locator('[data-slot="relationship-table-remove"]').click()

    // The row leaves the user's Posts table after the refresh…
    await expect(
      posts.locator('[data-slot="relationship-table-row"]', { hasText: `Drop ${stamp}` }),
    ).toHaveCount(0, { timeout: 10000 })
    // …but the other post is untouched.
    await expect(
      posts.locator('[data-slot="relationship-table-row"]', { hasText: `Keep ${stamp}` }),
    ).toBeVisible()

    // The disconnected post still EXISTS — it appears on the Post list page.
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    // Its unique slug identifies exactly one row (title/content both contain the
    // stamp, so match the slug cell to avoid an ambiguous text match).
    await expect(page.getByText(`drop-${stamp}`, { exact: true })).toBeVisible()
  })

  test('delete opt-in ✕ confirms, then deletes the note', async ({ page }) => {
    const user = generateTestUser()
    await signUp(page, user)

    const stamp = `${Date.now()}`
    const noteBody = `Note ${stamp}`
    await createNote(page, noteBody)

    await openCurrentUserEditPage(page, user.email)

    const notes = tableByHeading(page, 'Notes')
    await expect(notes).toBeVisible()
    const noteRow = notes.locator('[data-slot="relationship-table-row"]', { hasText: noteBody })
    await expect(noteRow).toBeVisible()

    // Delete opt-in: a confirmation is required.
    await noteRow.locator('[data-slot="relationship-table-remove"]').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()

    // The note leaves the table after the refresh…
    await expect(
      notes.locator('[data-slot="relationship-table-row"]', { hasText: noteBody }),
    ).toHaveCount(0, { timeout: 10000 })

    // …and is truly gone from the Note list page.
    await page.goto('/admin/note')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(noteBody)).toHaveCount(0)
  })
})
