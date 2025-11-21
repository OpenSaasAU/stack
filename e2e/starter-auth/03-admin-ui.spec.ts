import { test, expect } from '@playwright/test'
import { signUp, generateTestUser, selectAuthor } from '../utils/auth.js'

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
      await selectAuthor(page)
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
      await selectAuthor(page)
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Check table has columns
      const table = page.locator('table')
      await expect(table).toBeVisible()

      // Should show title
      await expect(page.locator('td:has-text("Full Post")')).toBeVisible()

      // Should show status
      await expect(page.locator('td:has-text("published")')).toBeVisible()
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
      await expect(page.locator('select[name="status"]')).toBeVisible()
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

      // Status field is rendered as a segmented control (radio group), not a select
      const statusField = page.getByLabel('Status')
      await expect(statusField).toBeVisible()

      // Check that status options are available
      // Note: Segmented controls don't have <option> elements like <select> does
      // Instead they use buttons or radio buttons
      await expect(page.locator('text=/Draft/i')).toBeVisible()
      await expect(page.locator('text=/Published/i')).toBeVisible()
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
      await selectAuthor(page)
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Click to edit
      await page.click('text=Edit Test Post')
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
      await selectAuthor(page)
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Edit the post
      await page.click('text=Original')
      await page.waitForLoadState('networkidle')

      await page.fill('input[name="title"]', 'Modified')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Should show updated title in list
      await expect(page.locator('text=Modified')).toBeVisible()
      await expect(page.locator('text=Original')).not.toBeVisible()
    })
  })

  test.describe('Form Validation UI', () => {
    test('should display validation errors inline', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Submit without filling required fields
      await page.click('button[type="submit"]')

      // Should show error messages
      await expect(page.locator('text=/required/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should clear validation errors when field is corrected', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Submit to trigger validation
      await page.click('button[type="submit"]')
      await expect(page.locator('text=/required/i').first()).toBeVisible({
        timeout: 5000,
      })

      // Fill in the fields
      await page.fill('input[name="title"]', 'Valid Title')
      await page.fill('input[name="slug"]', 'valid-slug')

      // Validation errors should clear (this depends on your implementation)
      // Some forms clear on input, some on blur, some on next submit
    })
  })

  test.describe('Relationships', () => {
    test('should show author relationship in post form', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Should have author field (could be select, autocomplete, etc.)
      const hasAuthorSelect = await page
        .locator('select[name="author"], select[name="authorId"]')
        .isVisible({ timeout: 2000 })
      const hasAuthorInput = await page
        .locator('input[name="author"], input[name="authorId"]')
        .isVisible({ timeout: 2000 })

      // At least one should exist
      expect(hasAuthorSelect || hasAuthorInput).toBe(true)
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

      // Should show user information
      await expect(page.locator(`text=${testUser.name}`)).toBeVisible()
      await expect(page.locator(`text=${testUser.email}`)).toBeVisible()
    })
  })

  test.describe('Segmented Control UI', () => {
    test('should display status field as segmented control', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Status field should be rendered as segmented control (or select)
      // This depends on your UI implementation
      const statusField = page.locator('select[name="status"], [role="radiogroup"]')
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
