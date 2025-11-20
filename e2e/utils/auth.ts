import { Page } from '@playwright/test'

/**
 * Test user credentials for E2E tests
 */
export const testUser = {
  email: 'test@example.com',
  password: 'testpassword123',
  name: 'Test User',
}

export const secondUser = {
  email: 'user2@example.com',
  password: 'testpassword456',
  name: 'Second User',
}

/**
 * Sign up a new user
 */
export async function signUp(
  page: Page,
  { email, password, name }: { email: string; password: string; name: string },
) {
  await page.goto('/sign-up')
  await page.fill('input#name', name)
  await page.fill('input#email', email)
  await page.fill('input#password', password)
  await page.fill('input#confirmPassword', password) // Fill confirm password field
  await page.click('button[type="submit"]')

  // Wait for redirect after successful signup
  await page.waitForURL('/', { timeout: 10000 })
}

/**
 * Sign in an existing user
 */
export async function signIn(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto('/sign-in')
  await page.fill('input#email', email)
  await page.fill('input#password', password)
  await page.click('button[type="submit"]')

  // Wait for redirect after successful signin
  await page.waitForURL('/', { timeout: 10000 })
}

/**
 * Sign out the current user
 */
export async function signOut(page: Page) {
  // Look for sign out button/link - adjust selector based on your UI
  await page.click('text=/sign out/i')
  await page.waitForURL('/sign-in', { timeout: 5000 })
}

/**
 * Check if user is signed in by looking for common UI elements
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  try {
    // Look for sign out text/button
    await page.waitForSelector('text=/sign out/i', { timeout: 2000 })
    return true
  } catch {
    return false
  }
}
