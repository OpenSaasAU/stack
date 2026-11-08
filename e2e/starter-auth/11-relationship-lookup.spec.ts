import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Relationship lookup in the Filter builder (#2253, part of #2246): choosing
 * the Author field browses and searches users, and picking one writes
 * `author:#id`, which matches exactly that user's posts even where another
 * user's name contains it. A to-many count on the User list links to the same
 * filter.
 */
test.describe('Relationship lookup', () => {
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

  const titleCell = (page: Page, title: string) =>
    page.getByRole('cell', { name: title, exact: true })

  test('picks an author by name, filters to exactly their posts, and links from a count', async ({
    page,
    browser,
  }) => {
    const tag = Math.random().toString(36).slice(2, 8)
    const exactName = `Lookup ${tag}`
    const similarName = `Lookup ${tag} Reed`
    const exact = generateTestUser(exactName)
    const similar = generateTestUser(similarName)

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await signUp(otherPage, exact)
    await createPost(otherPage, { title: `By ${exactName}`, slug: `lookup-exact-${tag}` })
    await other.close()

    await signUp(page, similar)
    await createPost(page, { title: `By ${similarName}`, slug: `lookup-similar-${tag}` })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.getByRole('combobox', { name: 'Filter post' }).fill('author')
    await page.getByRole('option', { name: 'Author', exact: true }).click()
    await page.keyboard.type(exactName)
    await expect(page.getByRole('option', { name: similarName, exact: true })).toBeVisible()
    await page.getByRole('option', { name: exactName, exact: true }).click()

    await page.waitForURL(/search=author(%3A|:)(%23|#)/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: `Author is ${exactName}` })).toBeVisible()
    await expect(titleCell(page, `By ${exactName}`)).toHaveCount(1)
    await expect(titleCell(page, `By ${similarName}`)).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: `Author is ${exactName}` })).toBeVisible()

    await page.goto(`/admin/user?search=${encodeURIComponent(similar.email)}`)
    await page.waitForLoadState('networkidle')
    const row = page.locator('tbody tr', { hasText: similar.email })
    await expect(row).toHaveCount(1)
    await row.getByRole('link', { name: '1', exact: true }).click()

    await page.waitForURL(/\/admin\/post\?search=author(%3A|:)(%23|#)/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: `Author is ${similarName}` })).toBeVisible()
    await expect(titleCell(page, `By ${similarName}`)).toHaveCount(1)
    await expect(titleCell(page, `By ${exactName}`)).toHaveCount(0)
  })
})
