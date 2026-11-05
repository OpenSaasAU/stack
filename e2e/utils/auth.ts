import * as path from 'node:path'
import { expect, request, type Cookie, type Page } from '@playwright/test'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import pg from 'pg'

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
  {
    email,
    password,
    redirectTo = '/admin',
  }: { email: string; password: string; redirectTo?: string },
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

async function sessionRowCount(sessionCookie: Cookie): Promise<number> {
  const connection = findDatabaseConnection({
    cwd: path.join(process.cwd(), 'examples', 'starter-auth'),
  })
  if (connection === undefined) throw new Error('No database found for examples/starter-auth.')

  // The cookie's value is `<token>.<signature>`, URL-encoded.
  const [token] = decodeURIComponent(sessionCookie.value).split('.')
  const client = new pg.Client({ connectionString: connection.url })
  await client.connect()
  try {
    const { rows } = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "Session" WHERE token = $1',
      [token],
    )
    return rows[0]?.count ?? 0
  } finally {
    await client.end()
  }
}

/**
 * Sign out through the admin's Sign Out control, and prove the session ended:
 * its row is gone, the browser holds no session cookie, and replaying the
 * cookie it held is refused.
 */
export async function signOut(page: Page) {
  const held = await page.context().cookies()
  const sessionCookie = held.find((cookie) => cookie.name.endsWith('session_token'))
  if (sessionCookie === undefined) throw new Error('signOut() needs a signed-in page.')
  expect(await sessionRowCount(sessionCookie)).toBe(1)

  // A document request, not a client-side transition: Next's client cache would
  // otherwise restore the signed-in admin on Back when `session.cookieCache` is on.
  const documentRequest = page.waitForRequest(
    (request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/sign-in',
    { timeout: 10000 },
  )
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await documentRequest
  await page.waitForURL('/sign-in', { timeout: 10000 })

  expect(await sessionRowCount(sessionCookie)).toBe(0)

  const remaining = await page.context().cookies()
  expect(remaining.filter((cookie) => cookie.name.includes('session_'))).toEqual([])

  const replay = await request.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { cookie: `${sessionCookie.name}=${sessionCookie.value}` },
  })
  try {
    const session = await replay.get('/api/auth/get-session')
    expect(await session.json()).toBeNull()
    const admin = await replay.get('/admin')
    expect(await admin.text()).toContain('Access Denied')
  } finally {
    await replay.dispose()
  }
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
