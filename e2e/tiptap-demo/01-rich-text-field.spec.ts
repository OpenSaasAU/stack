import { test, expect } from '@playwright/test'

/**
 * `examples/tiptap-demo` boots on its own port (playwright.config.ts's third
 * `webServer` entry) rather than the suite's shared `baseURL`, so every
 * navigation here is an absolute URL.
 */
const BASE_URL = 'http://localhost:3002'

test.describe('tiptap-demo custom field registration', () => {
  test('renders the registered Tiptap editor, not the unsupported-field fallback', async ({
    page,
  }) => {
    // `Article.content` and `Article.excerpt` register as `richText`. A
    // broken registration (a bare side-effect import of the client module
    // from a server component) renders FieldRenderer's generic fallback
    // instead of ever mounting Tiptap (#1398).
    await page.goto(`${BASE_URL}/admin/article/create`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=Unsupported field type')).toHaveCount(0)
    await expect(page.locator('.tiptap-toolbar').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bold' }).first()).toBeVisible()
  })

  test('blocks create when the required rich text field is left untouched', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/article/create`)
    await page.waitForLoadState('networkidle')

    const unique = `Untouched ${Date.now()}`
    await page.fill('input[name="title"]', unique)
    await page.fill('input[name="slug"]', `untouched-${Date.now()}`)
    // `content` is required and is never clicked into or typed into. This is
    // exactly the shape of the fixed regression (packages/tiptap's
    // TiptapField, see its `emitUpdate: false` comment): a rich text editor
    // that reports an empty document as a change on mount would satisfy a
    // required field with nothing the user wrote.
    await page.click('button[type="submit"]')
    await page.waitForLoadState('networkidle')

    // A correctly-behaving editor leaves the create blocked (client stays on
    // the create form; the server's required check has nothing to accept)
    // rather than silently succeeding with empty content.
    await expect(page).toHaveURL(/\/admin\/article\/create/)

    await page.goto(`${BASE_URL}/admin/article`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator(`text=${unique}`)).toHaveCount(0)
  })

  test('leaves an untouched optional rich text field empty after create', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/article/create`)
    await page.waitForLoadState('networkidle')

    const unique = `With content ${Date.now()}`
    await page.fill('input[name="title"]', unique)
    await page.fill('input[name="slug"]', `with-content-${Date.now()}`)

    // Type into the required `content` editor; leave the optional `excerpt`
    // editor untouched.
    const editors = page.locator('.tiptap.ProseMirror')
    await editors.first().click()
    await page.keyboard.type('This article has real content.')

    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin\/article$/, { timeout: 10000 })
    await expect(page.locator(`text=${unique}`)).toBeVisible({ timeout: 5000 })

    const articleRow = page.locator('tr', { has: page.locator(`text=${unique}`) })
    await articleRow.getByRole('link', { name: 'Edit' }).click()
    await page.waitForLoadState('networkidle')

    const editorsOnEditPage = page.locator('.tiptap.ProseMirror')
    await expect(editorsOnEditPage.first()).toContainText('This article has real content.')
    // `excerpt` is the second declared richText field, and was never touched.
    await expect(editorsOnEditPage.nth(1)).toHaveText('')
  })
})
