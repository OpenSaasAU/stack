import { test, expect, type Page } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

/**
 * OR groups in the Filter builder (issue #2251, ADR-0083): a group is built in
 * the bar, written to `?search=` as `(a OR b)`, and read back by the secured
 * server-side engine as the rows either side matches.
 */
test.describe('Filter builder OR groups', () => {
  let testUser: ReturnType<typeof generateTestUser>

  test.beforeEach(async ({ page }) => {
    testUser = generateTestUser()
    await signUp(page, testUser)
  })

  const marker = () => testUser.email.split('@')[0].replace(/-/g, '')

  async function createPost(
    page: Page,
    { title, status }: { title: string; status: 'draft' | 'published' },
  ) {
    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')
    await page.click('text=/create|new/i')
    await page.waitForLoadState('networkidle')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="slug"]', title.toLowerCase().replace(/\s+/g, '-'))
    await page.fill('textarea[name="content"]', 'Body content for the post.')
    if (status === 'published') {
      await page.getByLabel('Status').click()
      await page.getByRole('option', { name: 'published' }).click()
    }
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/post$/, { timeout: 10000 })
  }

  const titleCell = (page: Page, title: string) =>
    page.getByRole('cell', { name: title, exact: true })

  const filterBar = (page: Page) => page.getByRole('combobox', { name: 'Filter post' })

  const searchIs = (page: Page, query: string) =>
    page.waitForURL((url) => url.searchParams.get('search') === query, { timeout: 10000 })

  test('builds an OR group, reads its rows back, and splits and rejoins it', async ({ page }) => {
    const kiwi = `Kiwi ${marker()}`
    const mango = `Mango ${marker()}`
    const papaya = `Papaya ${marker()}`
    await createPost(page, { title: kiwi, status: 'draft' })
    await createPost(page, { title: mango, status: 'published' })
    await createPost(page, { title: papaya, status: 'published' })

    await page.goto('/admin/post')
    await page.waitForLoadState('networkidle')

    await filterBar(page).fill(marker())
    await page.getByRole('option', { name: `Search all text for “${marker()}”` }).click()
    await searchIs(page, marker())
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, papaya)).toBeVisible()

    await filterBar(page).fill('draft or mango')
    await expect(page.getByRole('option').first()).toHaveText(
      'Search all text for “draft or mango”',
    )
    await page.getByRole('option', { name: 'Status is Draft or Text contains mango' }).click()

    await searchIs(page, `${marker()} (status:draft OR mango)`)
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('group', { name: 'Any of: Status is Draft or Text contains mango' }),
    ).toBeVisible()
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, mango)).toBeVisible()
    await expect(titleCell(page, papaya)).toHaveCount(0)

    await page
      .getByRole('button', {
        name: 'Change or to and between Status is Draft and Text contains mango',
      })
      .click()
    await searchIs(page, `${marker()} status:draft mango`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: /^Any of:/ })).toHaveCount(0)
    await expect(titleCell(page, kiwi)).toHaveCount(0)
    await expect(titleCell(page, mango)).toHaveCount(0)

    await page
      .getByRole('button', {
        name: 'Change and to or between Status is Draft and Text contains mango',
      })
      .click()
    await searchIs(page, `${marker()} (status:draft OR mango)`)
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, mango)).toBeVisible()
    await expect(titleCell(page, papaya)).toHaveCount(0)
  })

  test('adds an alternative typed as `or` after a filter, and a bookmarked group reads back', async ({
    page,
  }) => {
    const kiwi = `Kiwi ${marker()}`
    const papaya = `Papaya ${marker()}`
    await createPost(page, { title: kiwi, status: 'draft' })
    await createPost(page, { title: papaya, status: 'published' })

    await page.goto(`/admin/post?search=${encodeURIComponent(`${marker()} kiwi`)}`)
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, papaya)).toHaveCount(0)

    await filterBar(page).click()
    await page.keyboard.type('or ')
    await expect(filterBar(page)).toHaveAttribute('placeholder', 'Add an alternative…')
    await page.keyboard.type('papaya')
    await page.getByRole('option', { name: 'Search all text for “papaya”' }).click()

    await searchIs(page, `${marker()} (kiwi OR papaya)`)
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, papaya)).toBeVisible()

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByRole('group', { name: 'Any of: Text contains kiwi or Text contains papaya' }),
    ).toBeVisible()
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, papaya)).toBeVisible()
  })

  test('applies a group typed in the URL grammar as that group', async ({ page }) => {
    const kiwi = `Kiwi ${marker()}`
    const mango = `Mango ${marker()}`
    const papaya = `Papaya ${marker()}`
    await createPost(page, { title: kiwi, status: 'draft' })
    await createPost(page, { title: mango, status: 'published' })
    await createPost(page, { title: papaya, status: 'published' })

    await page.goto(`/admin/post?search=${encodeURIComponent(marker())}`)
    await page.waitForLoadState('networkidle')
    await filterBar(page).click()
    await page.keyboard.type('(kiwi OR mango)')
    await page.keyboard.press('Enter')

    await searchIs(page, `${marker()} (kiwi OR mango)`)
    await page.waitForLoadState('networkidle')
    await expect(titleCell(page, kiwi)).toBeVisible()
    await expect(titleCell(page, mango)).toBeVisible()
    await expect(titleCell(page, papaya)).toHaveCount(0)
  })
})
