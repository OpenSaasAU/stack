import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * Preset views (issue #2256): the starter-auth `Post` list's "My drafts" tab,
 * resolved on the server against each session, so one shared link shows each
 * person their own drafts.
 */
test.describe('Preset views', () => {
  async function createPost(page: Page, title: string, slug: string) {
    await page.goto('/admin/post/create')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', slug)
    await page.fill('textarea[name="content"]', 'content')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  const rowTitles = (page: Page) => page.locator('[data-slot="row-title-link"]')
  const titled = (...titles: string[]) => titles.map((title) => new RegExp(`${title}$`))

  test('open My drafts, refine it, and share its link with an author whose name contains the first', async ({
    page,
    browser,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const ada = `Preset Ada ${stamp}`
    await signUp(page, generateTestUser(ada))
    await createPost(page, `Ada beta ${stamp}`, `ada-beta-${stamp}`)
    await createPost(page, `Ada alpha ${stamp}`, `ada-alpha-${stamp}`)

    await page.goto('/admin/post')
    const views = page.getByRole('navigation', { name: 'Post views' })
    await expect(views.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')

    await views.getByRole('link', { name: 'My drafts' }).click()
    await page.waitForURL(/[?&]preset=my-drafts/)
    await expect(views.getByRole('link', { name: 'My drafts' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(rowTitles(page)).toHaveText(titled(`Ada alpha ${stamp}`, `Ada beta ${stamp}`))

    const presetUrl = page.url()

    await page.getByRole('button', { name: /^Title/ }).click()
    await page.waitForURL((url) => !url.searchParams.has('preset'))
    const expanded = new URL(page.url())
    expect(expanded.searchParams.get('search')).toBe(`status:draft author:"${ada}"`)
    expect(expanded.searchParams.get('sort')).toBe('title:desc')
    await expect(rowTitles(page)).toHaveText(titled(`Ada beta ${stamp}`, `Ada alpha ${stamp}`))
    for (const tab of await views.getByRole('link').all()) {
      await expect(tab).not.toHaveAttribute('aria-current')
    }

    const other = await browser.newContext()
    const junior = await other.newPage()
    try {
      await signUp(junior, generateTestUser(`${ada} Junior`))
      await createPost(junior, `Junior draft ${stamp}`, `junior-draft-${stamp}`)

      await junior.goto(presetUrl)
      await expect(
        junior
          .getByRole('navigation', { name: 'Post views' })
          .getByRole('link', { name: 'My drafts' }),
      ).toHaveAttribute('aria-current', 'page')
      await expect(rowTitles(junior)).toHaveText(titled(`Junior draft ${stamp}`))
    } finally {
      await other.close()
    }
  })

  test('an unknown preset link opens the plain list', async ({ page }) => {
    await signUp(page, generateTestUser(`Preset Unknown ${Date.now()}`))
    await page.goto('/admin/post?preset=does-not-exist')
    const views = page.getByRole('navigation', { name: 'Post views' })
    await expect(views.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('combobox', { name: 'Filter post' })).toHaveValue('')
  })
})
