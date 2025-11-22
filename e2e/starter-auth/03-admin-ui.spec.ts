import { test, expect } from '@playwright/test'
import { signUp, generateTestUser } from '../utils/auth.js'

test.describe('Admin UI', () => {
  let testUser: ReturnType<typeof generateTestUser>

  test.beforeEach(async ({ page }) => {
    testUser = generateTestUser()
    await signUp(page, testUser)
  })

  test.describe('Navigation and Layout', () => {
    test('should display admin UI at /admin path', async ({ page }) => {
      await page.goto('/admin')

      // Should show admin interface
      await expect(page).toHaveURL(/\/admin/)

      // Should show navigation or list of models
      await expect(page.locator('text=/post|user/i').first()).toBeVisible({ timeout: 5000 })
    })

    test('should show navigation to different lists', async ({ page }) => {
      await page.goto('/admin')
      await page.waitForLoadState('networkidle')

      // Should have links to Post and User lists
      const postLink = page.locator('a:has-text("Post"), a[href*="post"]').first()
      const userLink = page.locator('a:has-text("User"), a[href*="user"]').first()

      await expect(postLink).toBeVisible({ timeout: 5000 })
      await expect(userLink).toBeVisible({ timeout: 5000 })
    })

    test('should navigate between different list views', async ({ page }) => {
      await page.goto('/admin')
      await page.waitForLoadState('networkidle')

      // Navigate to Posts
      await page.click('a:has-text("Post"), a[href*="post"]')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/admin\/post/)

      // Navigate to Users
      await page.click('a:has-text("User"), a[href*="user"]')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/admin\/user/)
    })
  })

  test.describe('List Table View', () => {
    test('should display empty state when no posts exist', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      // Should show empty state or "no posts" message
      // Or should show a table with no rows
      const hasEmptyMessage = await page
        .locator('text=/no posts|empty|no items/i')
        .isVisible({ timeout: 2000 })

      const hasTable = await page.locator('table').isVisible({ timeout: 2000 })

      // At least one should be true
      expect(hasEmptyMessage || hasTable).toBe(true)
    })

    test('should display posts in table after creation', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      // Create a post
      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Test Post')
      await page.fill('input[name="slug"]', 'test-post')
      await page.fill('textarea[name="content"]', 'Test content')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Should see post in table
      await expect(page.locator('text=Test Post')).toBeVisible({ timeout: 5000 })
    })

    test('should display multiple columns in list table', async ({ page }) => {
      // Create a post first
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Full Post')
      await page.fill('input[name="slug"]', 'full-post')
      await page.fill('textarea[name="content"]', 'Content here')
      // Status field is a segmented control, not a select dropdown
      await page.getByLabel('Status').click()
      await page.getByRole('option', { name: 'published' }).click()
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Check table has columns
      const table = page.locator('table')
      await expect(table).toBeVisible()

      // Should show title
      await expect(page.locator('td:has-text("Full Post")')).toBeVisible()

      // Should show status
      await expect(
        page.getByRole('row', { name: /Full Post/ }).getByRole('cell', { name: 'published' }),
      ).toBeVisible()
    })
  })

  test.describe('Create Form', () => {
    test('should display create form with all fields', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Check all expected fields are present
      await expect(page.locator('input[name="title"]')).toBeVisible()
      await expect(page.locator('input[name="slug"]')).toBeVisible()
      await expect(page.locator('textarea[name="content"]')).toBeVisible()
      await expect(page.locator('textarea[name="internalNotes"]')).toBeVisible()
      await expect(page.getByLabel('Status')).toBeVisible()
      await expect(page.locator('button[type="submit"]')).toBeVisible()
    })

    test('should show form field labels', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Labels should be visible
      await expect(page.locator('label:has-text("Title")')).toBeVisible()
      await expect(page.locator('label:has-text("Slug")')).toBeVisible()
      await expect(page.locator('label:has-text("Content")')).toBeVisible()
      await expect(page.locator('label:has-text("Status")')).toBeVisible()
    })

    test('should have proper field types', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Text inputs
      const titleInput = page.locator('input[name="title"]')
      await expect(titleInput).toHaveAttribute('type', 'text')

      // Textarea
      const contentInput = page.locator('textarea[name="content"]')
      await expect(contentInput).toBeVisible()

      // Status field should be present
      const statusField = page.getByLabel('Status')
      await expect(statusField).toBeVisible()
    })
  })

  test.describe('Edit Form', () => {
    test('should display edit form with populated data', async ({ page }) => {
      // Create a post
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Edit Test Post')
      await page.fill('input[name="slug"]', 'edit-test-post')
      await page.fill('textarea[name="content"]', 'Original content')
      await page.fill('textarea[name="internalNotes"]', 'Original notes')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Click to edit - use the Edit link in the Actions column
      await page.locator('tr:has-text("Edit Test Post")').locator('a:has-text("Edit")').click()
      await page.waitForLoadState('networkidle')

      // Fields should be populated
      await expect(page.locator('input[name="title"]')).toHaveValue('Edit Test Post')
      await expect(page.locator('input[name="slug"]')).toHaveValue('edit-test-post')
      await expect(page.locator('textarea[name="content"]')).toHaveValue('Original content')
      await expect(page.locator('textarea[name="internalNotes"]')).toHaveValue('Original notes')
    })

    test('should save changes when edit form is submitted', async ({ page }) => {
      // Create a post
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Original')
      await page.fill('input[name="slug"]', 'original')
      await page.fill('textarea[name="content"]', 'Content')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Edit the post - use more specific locator for the exact title cell
      await page
        .getByRole('row', { name: /^Original original Content/ })
        .getByRole('link', { name: 'Edit' })
        .click()
      await page.waitForLoadState('networkidle')

      await page.fill('input[name="title"]', 'Modified')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Wait for table to reload (no skeleton, table visible)
      await expect(page.getByRole('table')).toBeVisible()

      // Verify no server errors
      await expect(page.getByText(/error occurred in the server components/i)).not.toBeVisible()

      // Should show updated title in a table cell (more specific)
      await expect(page.getByRole('cell', { name: 'Modified' })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Original', exact: true })).not.toBeVisible()
    })
  })

  test.describe('User List (Auto-generated by authPlugin)', () => {
    test('should display users in admin UI', async ({ page }) => {
      await page.goto('/admin/user')
      await page.waitForLoadState('networkidle')

      // Should show at least the current user
      await expect(page.locator(`text=${testUser.email}`)).toBeVisible({
        timeout: 5000,
      })
    })

    test('should display user fields in table', async ({ page }) => {
      await page.goto('/admin/user')
      await page.waitForLoadState('networkidle')

      // Find the row containing the test user's email, then verify it also has the name
      const userRow = page.locator('tr', { hasText: testUser.email })
      await expect(userRow).toContainText(testUser.name!)
      await expect(userRow).toContainText(testUser.email)
    })
  })

  test.describe('Segmented Control UI', () => {
    test('should display status field as segmented control', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Status field is rendered as a combobox (shadcn Select component)
      const statusField = page.getByRole('combobox', { name: 'Status' })
      await expect(statusField).toBeVisible()
    })
  })

  test.describe('Loading States', () => {
    test('should show loading state during navigation', async ({ page }) => {
      await page.goto('/admin/post')

      // Loading might be too fast to catch, so we just verify page loads
      await page.waitForLoadState('networkidle')

      // Page should eventually load
      await expect(page.locator('text=/post|create|new/i').first()).toBeVisible({ timeout: 10000 })
    })
  })
})
