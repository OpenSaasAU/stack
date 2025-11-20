import { test, expect } from '@playwright/test'
import { signUp, testUser } from '../utils/auth.js'

test.describe('Authentication', () => {
  test.describe('Sign Up', () => {
    test('should successfully sign up a new user', async ({ page }) => {
      await page.goto('/sign-up', { waitUntil: 'networkidle' })

      // Wait for form to be ready
      await page.waitForSelector('input#name:not([disabled])', { state: 'visible' })

      // Fill in the form using role-based selectors
      await page.getByRole('textbox', { name: 'Name' }).fill(testUser.name)
      await page.getByRole('textbox', { name: 'Email' }).fill(testUser.email)
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill(testUser.password)
      await page.getByRole('textbox', { name: 'Confirm Password' }).fill(testUser.password)

      // Submit the form
      await page.getByRole('button', { name: 'Sign Up' }).click()

      // Should redirect to home page after successful signup
      await page.waitForURL('/', { timeout: 10000 })

      // Verify we're logged in (look for sign out button/link)
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })

    test('should show validation error for invalid email', async ({ page }) => {
      await page.goto('/sign-up', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#name:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Name' }).fill('Test User')
      await page.getByRole('textbox', { name: 'Email' }).fill('invalid-email')
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password123')
      await page.getByRole('textbox', { name: 'Confirm Password' }).fill('password123')

      await page.getByRole('button', { name: 'Sign Up' }).click()

      // Should show error message (adjust selector based on your error UI)
      await expect(page.locator('text=/invalid|error/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should show validation error for short password', async ({ page }) => {
      await page.goto('/sign-up', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#name:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Name' }).fill('Test User')
      await page.getByRole('textbox', { name: 'Email' }).fill('test@example.com')
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('short')
      await page.getByRole('textbox', { name: 'Confirm Password' }).fill('short')

      await page.getByRole('button', { name: 'Sign Up' }).click()

      // Should show error message about password length
      await expect(page.locator('text=/password|8|characters/i')).toBeVisible({
        timeout: 5000,
      })
    })

    test('should prevent duplicate email registration', async ({ page }) => {
      // First sign up
      await signUp(page, testUser)

      // Navigate back to sign up
      await page.goto('/sign-up', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#name:not([disabled])', { state: 'visible' })

      // Try to sign up with same email
      await page.getByRole('textbox', { name: 'Name' }).fill('Another User')
      await page.getByRole('textbox', { name: 'Email' }).fill(testUser.email)
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('anotherpassword123')
      await page.getByRole('textbox', { name: 'Confirm Password' }).fill('anotherpassword123')

      await page.getByRole('button', { name: 'Sign Up' }).click()

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

    test('should successfully sign in with correct credentials', async ({ page }) => {
      await page.goto('/sign-in', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#email:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Email' }).fill(testUser.email)
      await page.getByRole('textbox', { name: 'Password' }).fill(testUser.password)

      await page.getByRole('button', { name: 'Sign In' }).click()

      // Should redirect to home page
      await page.waitForURL('/', { timeout: 10000 })

      // Verify we're logged in
      await expect(page.locator('text=/sign out/i')).toBeVisible()
    })

    test('should show error for incorrect password', async ({ page }) => {
      await page.goto('/sign-in', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#email:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Email' }).fill(testUser.email)
      await page.getByRole('textbox', { name: 'Password' }).fill('wrongpassword')

      await page.getByRole('button', { name: 'Sign In' }).click()

      // Should show error message
      await expect(page.locator('text=/invalid|incorrect|error/i')).toBeVisible({ timeout: 5000 })
    })

    test('should show error for non-existent user', async ({ page }) => {
      await page.goto('/sign-in', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#email:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Email' }).fill('nonexistent@example.com')
      await page.getByRole('textbox', { name: 'Password' }).fill('password123')

      await page.getByRole('button', { name: 'Sign In' }).click()

      // Should show error message
      await expect(page.locator('text=/invalid|not found|error/i')).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Password Reset', () => {
    test('should display password reset page', async ({ page }) => {
      await page.goto('/forgot-password', { waitUntil: 'networkidle' })

      // Should show email input using role selector
      await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()

      // Should have submit button
      await expect(page.getByRole('button', { name: /reset|submit/i })).toBeVisible()
    })

    test('should accept email submission for password reset', async ({ page }) => {
      await page.goto('/forgot-password', { waitUntil: 'networkidle' })
      await page.waitForSelector('input#email:not([disabled])', { state: 'visible' })

      await page.getByRole('textbox', { name: 'Email' }).fill(testUser.email)
      await page.getByRole('button', { name: /reset|submit/i }).click()

      // Should show success message or confirmation
      // Note: Actual email won't be sent in test environment
      await expect(page.locator('text=/email|sent|check|link/i')).toBeVisible({ timeout: 5000 })
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
