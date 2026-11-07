import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3005'

test.describe('next dev serves the admin', () => {
  test('/admin renders without a server error', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/admin`)
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /product/i }).first()).toBeVisible()
  })

  test('a list page renders', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/admin/product`)
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /product/i }).first()).toBeVisible()
  })

  test('the registered custom field mounts in the create form', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/admin/product/create`)
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Unsupported field type')).toHaveCount(0)
  })
})
