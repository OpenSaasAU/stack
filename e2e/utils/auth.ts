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
 * Generate a unique test user to avoid email conflicts between tests
 * Uses timestamp + random string to ensure uniqueness
 */
export function generateTestUser(name = 'Test User') {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  return {
    email: `test-${timestamp}-${random}@example.com`,
    password: 'testpassword123',
    name,
  }
}

/**
 * Sign up a new user
 */
export async function signUp(
  page: Page,
  {
    email,
    password,
    name,
    redirectTo = '/admin',
  }: { email: string; password: string; name: string; redirectTo?: string },
) {
  await page.goto('/sign-up', { waitUntil: 'networkidle' })

  // Wait for the form to be ready (React hydration)
  await page.waitForSelector('input#name:not([disabled])', { state: 'visible' })

  // Use role-based selectors for better reliability
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
  await page.getByRole('textbox', { name: 'Confirm Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign Up' }).click()

  // Wait for redirect after successful signup
  await page.waitForURL(redirectTo, { timeout: 10000 })
}

/**
 * Sign in an existing user
 */
export async function signIn(
  page: Page,
  { email, password, redirectTo = '/admin' }: { email: string; password: string; redirectTo?: string },
) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })

  // Wait for the form to be ready (React hydration)
  await page.waitForSelector('input#email:not([disabled])', { state: 'visible' })

  // Use role-based selectors for better reliability
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()

  // Wait for redirect after successful signin
  await page.waitForURL(redirectTo, { timeout: 10000 })
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
