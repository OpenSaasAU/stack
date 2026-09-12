import { test, expect } from '@playwright/test'

/**
 * `examples/json-demo` boots on its own port (playwright.config.ts's second
 * `webServer` entry) rather than the suite's shared `baseURL`, so every
 * navigation here is an absolute URL.
 */
const BASE_URL = 'http://localhost:3005'

test.describe('json-demo custom field registration', () => {
  test('renders the registered JsonEditor and TaxonomyField controls', async ({ page }) => {
    // `Product.settings` registers as `jsonEditor` via `ui.fieldType`. A
    // broken registration (a bare side-effect import of the client module
    // from a server component) renders FieldRenderer's generic fallback
    // instead of ever reaching this component (#1398).
    await page.goto(`${BASE_URL}/admin/product/create`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=Unsupported field type')).toHaveCount(0)
    await expect(page.locator('textarea[name="settings"]')).toBeVisible()
    await expect(page.getByText('Preview', { exact: true }).first()).toBeVisible()

    // `Article.taxonomy` registers as `taxonomy`.
    await page.goto(`${BASE_URL}/admin/article/create`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=Unsupported field type')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add Item' })).toBeVisible()
  })

  test('leaves an untouched optional JSON field absent rather than an empty object', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/product/create`)
    await page.waitForLoadState('networkidle')

    const uniqueName = `Widget ${Date.now()}`
    await page.fill('input[name="name"]', uniqueName)
    // `configuration` is required; `settings` is optional and stays untouched
    // — this is the shape of the mount-time-write regression from #1398/#1388,
    // just for a JSON field rather than Tiptap's rich text.
    await page.fill('textarea[name="configuration"]', '{"sku": "W-1"}')

    await page.click('button[type="submit"]')
    // The create form's `router.push`/`router.refresh()` pair back to the list
    // page doesn't reliably land as a client-side transition under load — the
    // save itself is what this test cares about, so wait for the mutation's
    // own request to settle and read the result back from a fresh navigation
    // rather than depending on that transition committing.
    await page.waitForLoadState('networkidle')
    await page.goto(`${BASE_URL}/admin/product`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 5000 })

    // Reopen the created row: a reintroduced bug that writes `{}` into an
    // untouched field would show up here as the editor holding the text
    // `"{}"` instead of nothing.
    const productRow = page.locator('tr', { has: page.locator(`text=${uniqueName}`) })
    await productRow.getByRole('link', { name: 'Edit' }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('textarea[name="settings"]')).toHaveValue('')
  })
})
