import { test, expect } from '@playwright/test'
import { signUp, signIn, testUser, secondUser } from '../utils/auth.js'

test.describe('Authentication', () => {
  test.describe('Sign Up', () => {
    test('should successfully sign up a new user', async ({ page }) => {
      await page.goto('/sign-up')

      // Fill in the form
      await page.fill('input[name="name"]', testUser.name)
      await page.fill('input[name="email"]', testUser.email)
      await page.fill('input[name="password"]', testUser.password)

      // Submit the form
      await page.click('button[type="submit"]')

      // Should redirect to home page after successful signup
      await page.waitForURL('/', { timeout: 10000 })

      // Verify we're logged in (look for sign out button/link)
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })

    test('should show validation error for invalid email', async ({ page }) => {
      await page.goto('/sign-up')

      await page.fill('input[name="name"]', 'Test User')
      await page.fill('input[name="email"]', 'invalid-email')
      await page.fill('input[name="password"]', 'password123')

      await page.click('button[type="submit"]')

      // Should show error message (adjust selector based on your error UI)
      await expect(page.locator('text=/invalid|error/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should show validation error for short password', async ({ page }) => {
      await page.goto('/sign-up')

      await page.fill('input[name="name"]', 'Test User')
      await page.fill('input[name="email"]', 'test@example.com')
      await page.fill('input[name="password"]', 'short') // Less than 8 characters

      await page.click('button[type="submit"]')

      // Should show error message about password length
      await expect(page.locator('text=/password|8|characters/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should prevent duplicate email registration', async ({ page }) => {
      // First sign up
      await signUp(page, testUser)

      // Navigate back to sign up
      await page.goto('/sign-up')

      // Try to sign up with same email
      await page.fill('input[name="name"]', 'Another User')
      await page.fill('input[name="email"]', testUser.email)
      await page.fill('input[name="password"]', 'anotherpassword123')

      await page.click('button[type="submit"]')

      // Should show error about email already being used
      await expect(page.locator('text=/already|exists/i')).toBeVisible({
        timeout: 5000,
      })
    })
  })

  test.describe('Sign In', () => {
    test.beforeEach(async ({ page }) => {
      // Create a user before each sign-in test
      await signUp(page, testUser)
      // Sign out to test sign in
      await page.goto('/sign-in')
    })

    test('should successfully sign in with correct credentials', async ({
      page,
    }) => {
      await page.goto('/sign-in')

      await page.fill('input[name="email"]', testUser.email)
      await page.fill('input[name="password"]', testUser.password)

      await page.click('button[type="submit"]')

      // Should redirect to home page
      await page.waitForURL('/', { timeout: 10000 })

      // Verify we're logged in
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })

    test('should show error for incorrect password', async ({ page }) => {
      await page.goto('/sign-in')

      await page.fill('input[name="email"]', testUser.email)
      await page.fill('input[name="password"]', 'wrongpassword')

      await page.click('button[type="submit"]')

      // Should show error message
      await expect(page.locator('text=/invalid|incorrect|error/i')).toBeVisible(
        { timeout: 5000 }
      )
    })

    test('should show error for non-existent user', async ({ page }) => {
      await page.goto('/sign-in')

      await page.fill('input[name="email"]', 'nonexistent@example.com')
      await page.fill('input[name="password"]', 'password123')

      await page.click('button[type="submit"]')

      // Should show error message
      await expect(page.locator('text=/invalid|not found|error/i')).toBeVisible(
        { timeout: 5000 }
      )
    })
  })

  test.describe('Password Reset', () => {
    test('should display password reset page', async ({ page }) => {
      await page.goto('/forgot-password')

      // Should show email input
      await expect(page.locator('input[name="email"]')).toBeVisible()

      // Should have submit button
      await expect(page.locator('button[type="submit"]')).toBeVisible()
    })

    test('should accept email submission for password reset', async ({
      page,
    }) => {
      await page.goto('/forgot-password')

      await page.fill('input[name="email"]', testUser.email)
      await page.click('button[type="submit"]')

      // Should show success message or confirmation
      // Note: Actual email won't be sent in test environment
      await expect(
        page.locator('text=/email|sent|check|link/i')
      ).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Session Persistence', () => {
    test('should maintain session across page reloads', async ({ page }) => {
      // Sign up and verify logged in
      await signUp(page, testUser)
      await expect(page.locator('text=/sign out/i')).toBeVisible()

      // Reload the page
      await page.reload()

      // Should still be logged in
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })

    test('should maintain session across navigation', async ({ page }) => {
      await signUp(page, testUser)

      // Navigate to different pages
      await page.goto('/admin')
      await expect(page.locator('text=/sign out/i')).toBeVisible()

      await page.goto('/')
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })
  })
})
