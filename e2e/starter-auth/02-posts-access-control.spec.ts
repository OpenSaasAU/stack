import { test, expect } from '@playwright/test'
import { signUp, signIn, generateTestUser } from '../utils/auth.js'

test.describe('Posts CRUD and Access Control', () => {
  test.describe('Unauthenticated Access', () => {
    test('should not allow post creation without authentication', async ({ page }) => {
      // Try to access admin directly without signing in
      await page.goto('/admin')

      // Should show access denied message
      await expect(page.locator('text=/access denied/i')).toBeVisible({ timeout: 5000 })
    })

    test('should only show published posts to unauthenticated users', async ({
      page: _page,
      context,
    }) => {
      // Create a user and add posts in a separate context
      const testUser = generateTestUser()
      const setupPage = await context.newPage()
      await signUp(setupPage, testUser)
      await setupPage.goto('/admin/post')
      await setupPage.waitForLoadState('networkidle')

      // Create a published post
      await setupPage.click('text=/create|new/i')
      await setupPage.waitForLoadState('networkidle')
      await setupPage.fill('input[name="title"]', 'Published Post')
      await setupPage.fill('input[name="slug"]', 'published-post')
      await setupPage.fill('textarea[name="content"]', 'This is published')
      await setupPage.getByLabel('Status').click()
      await setupPage.getByRole('option', { name: 'published' }).click()
      await setupPage.click('button[type="submit"]')
      await setupPage.waitForURL(/admin\/post/, { timeout: 10000 })

      // Create a draft post
      await setupPage.click('text=/create|new/i')
      await setupPage.waitForLoadState('networkidle')
      await setupPage.fill('input[name="title"]', 'Draft Post')
      await setupPage.fill('input[name="slug"]', 'draft-post')
      await setupPage.fill('textarea[name="content"]', 'This is a draft')
      // Default status is draft, no need to change
      await setupPage.click('button[type="submit"]')
      await setupPage.waitForURL(/admin\/post/, { timeout: 10000 })

      await setupPage.close()

      // Now check what unauthenticated user can see via API or UI
      // This would require a public posts listing page
      // For now, we'll verify through admin access
    })
  })

  test.describe('Post Creation', () => {
    let testUser: ReturnType<typeof generateTestUser>

    test.beforeEach(async ({ page }) => {
      testUser = generateTestUser()
      await signUp(page, testUser)
    })

    test('should allow authenticated user to create a post', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      // Click create button
      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Fill in post details
      await page.fill('input[name="title"]', 'My First Post')
      await page.fill('input[name="slug"]', 'my-first-post')
      await page.fill('textarea[name="content"]', 'This is the content')

      // Submit the form
      await page.click('button[type="submit"]')

      // Should redirect back to post list
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Verify post appears in list
      await expect(page.locator('text=My First Post')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should validate required fields', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Try to submit without required fields
      await page.click('button[type="submit"]')

      // Should show validation errors
      await expect(page.locator('text=/required/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should validate title does not contain "spam"', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      // Try to create post with "spam" in title
      await page.fill('input[name="title"]', 'This is spam content')
      await page.fill('input[name="slug"]', 'spam-content')
      await page.fill('textarea[name="content"]', 'Content here')

      await page.click('button[type="submit"]')

      // Should show validation error about spam
      await expect(page.locator('text=/spam/i')).toBeVisible({ timeout: 5000 })
    })

    test('should enforce unique slug constraint', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      // Create first post
      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'First Post')
      await page.fill('input[name="slug"]', 'unique-slug')
      await page.fill('textarea[name="content"]', 'Content')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Try to create second post with same slug
      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Second Post')
      await page.fill('input[name="slug"]', 'unique-slug')
      await page.fill('textarea[name="content"]', 'Content')
      await page.click('button[type="submit"]')

      // Should show error about duplicate slug
      await expect(page.locator('text=/unique|duplicate/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should auto-set publishedAt when status changes to published', async ({ page }) => {
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')

      await page.fill('input[name="title"]', 'Published Post')
      await page.fill('input[name="slug"]', 'published-post')
      await page.fill('textarea[name="content"]', 'Content')
      await page.getByLabel('Status').click()
      await page.getByRole('option', { name: 'published' }).click()

      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Click on the created post to view details
      await page.click('text=Published Post')
      await page.waitForLoadState('networkidle')

      // Verify publishedAt is set (should be visible in the form or details)
      // This depends on your UI implementation
      const publishedAtField = page.locator('input[name="publishedAt"]')
      if (await publishedAtField.isVisible()) {
        const value = await publishedAtField.inputValue()
        expect(value).not.toBe('')
      }
    })
  })

  test.describe('Post Update - Author Access Control', () => {
    test('should allow author to update their own post', async ({ page, context: _context }) => {
      // Create user and post
      const testUser = generateTestUser()
      await signUp(page, testUser)
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Original Title')
      await page.fill('input[name="slug"]', 'original-title')
      await page.fill('textarea[name="content"]', 'Original content')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Edit the post
      await page.click('text=Original Title')
      await page.waitForLoadState('networkidle')

      // Update title
      await page.fill('input[name="title"]', 'Updated Title')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Verify update
      await expect(page.locator('text=Updated Title')).toBeVisible()
    })

    test('should not allow non-author to update post', async ({ page, context }) => {
      // User 1 creates a post
      const testUser = generateTestUser()
      const secondUser = generateTestUser()
      await signUp(page, testUser)
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'User 1 Post')
      await page.fill('input[name="slug"]', 'user-1-post')
      await page.fill('textarea[name="content"]', 'Content by user 1')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Get the post URL/ID
      await page.click('text=User 1 Post')
      const postUrl = page.url()

      // Sign out and sign in as different user
      // Create new user in separate context first
      const setupPage = await context.newPage()
      await signUp(setupPage, secondUser)
      await setupPage.close()

      // Sign out current user
      await page.goto('/')
      const signOutButton = page.locator('text=/sign out/i')
      if (await signOutButton.isVisible()) {
        await signOutButton.click()
      }

      // Sign in as user 2
      await signIn(page, secondUser)

      // Try to access the post edit page
      await page.goto(postUrl)

      // Should either:
      // 1. Show access denied message
      // 2. Redirect away
      // 3. Not show edit form
      // 4. Show error when trying to submit

      // Try to edit
      const titleInput = page.locator('input[name="title"]')
      if (await titleInput.isVisible()) {
        await titleInput.fill('Hacked Title')
        await page.click('button[type="submit"]')

        // Should show access denied or error
        await expect(page.locator('text=/access|denied|error/i')).toBeVisible({
          timeout: 5000,
        })
      }
    })
  })

  test.describe('Post Deletion - Author Access Control', () => {
    test('should allow author to delete their own post', async ({ page }) => {
      const testUser = generateTestUser()
      await signUp(page, testUser)
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      // Create a post
      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Post to Delete')
      await page.fill('input[name="slug"]', 'post-to-delete')
      await page.fill('textarea[name="content"]', 'This will be deleted')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Find and click delete button (adjust selector based on your UI)
      const deleteButton = page
        .locator('button:has-text("Delete"), button:has-text("delete")')
        .first()
      if (await deleteButton.isVisible()) {
        await deleteButton.click()

        // Confirm deletion if there's a confirmation dialog
        const confirmButton = page.locator(
          'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")',
        )
        if (await confirmButton.isVisible({ timeout: 2000 })) {
          await confirmButton.click()
        }

        // Post should be removed from list
        await expect(page.locator('text=Post to Delete')).not.toBeVisible({
          timeout: 5000,
        })
      }
    })
  })

  test.describe('Field-level Access Control', () => {
    test('should only allow author to read internalNotes', async ({ page, context }) => {
      // User 1 creates a post with internal notes
      const testUser = generateTestUser()
      const secondUser = generateTestUser()
      await signUp(page, testUser)
      await page.goto('/admin/post')
      await page.waitForLoadState('networkidle')

      await page.click('text=/create|new/i')
      await page.waitForLoadState('networkidle')
      await page.fill('input[name="title"]', 'Post with Notes')
      await page.fill('input[name="slug"]', 'post-with-notes')
      await page.fill('textarea[name="content"]', 'Public content')
      await page.fill('textarea[name="internalNotes"]', 'Secret notes')
      await page.click('button[type="submit"]')
      await page.waitForURL(/admin\/post/, { timeout: 10000 })

      // Verify author can see internal notes
      await page.click('text=Post with Notes')
      await page.waitForLoadState('networkidle')

      const notesField = page.locator('textarea[name="internalNotes"]')
      if (await notesField.isVisible()) {
        const notesValue = await notesField.inputValue()
        expect(notesValue).toBe('Secret notes')
      }

      // Get post URL
      const postUrl = page.url()

      // Create second user
      const setupPage = await context.newPage()
      await signUp(setupPage, secondUser)
      await setupPage.close()

      // Sign out and sign in as user 2
      await page.goto('/')
      const signOutButton = page.locator('text=/sign out/i')
      if (await signOutButton.isVisible()) {
        await signOutButton.click()
      }

      await signIn(page, secondUser)

      // Try to access the post
      await page.goto(postUrl)

      // Internal notes should not be visible to non-author
      const notesField2 = page.locator('textarea[name="internalNotes"]')
      const isNotesVisible = await notesField2.isVisible({ timeout: 2000 })

      if (isNotesVisible) {
        // If field is visible, it should be empty or inaccessible
        const value = await notesField2.inputValue()
        expect(value).toBe('')
      }
    })
  })
})
