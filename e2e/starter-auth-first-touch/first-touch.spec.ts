import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test'
import { generateTestUser } from '../utils/auth.js'
import {
  canStartFreshApp,
  startFreshApp,
  type FreshApp,
  type FreshAppMode,
} from '../utils/fresh-app.js'

/**
 * The first database touch of a server process decides which bundle instance
 * builds the shared context (#2240, fixed by #2346). Each case starts a server
 * nobody has touched and makes its first touch either a route handler
 * (`POST /api/auth/sign-up/email`) or a page render, then does a write from the
 * admin that goes through the secured row lock.
 */
const orders = ['route-handler-first', 'page-first'] as const
const modes: readonly { mode: FreshAppMode; port: number }[] = [
  { mode: 'production', port: 3101 },
  { mode: 'dev', port: 3102 },
]

async function signUpThroughRouteHandler(app: FreshApp, user: ReturnType<typeof generateTestUser>) {
  const api = await request.newContext({ baseURL: app.baseURL })
  const response = await api.post('/api/auth/sign-up/email', {
    data: user,
    headers: { Origin: app.baseURL },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return api
}

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>

async function adminWritesAndRowAction(
  browser: Browser,
  app: FreshApp,
  storageState: StorageState,
) {
  const context = await browser.newContext({ baseURL: app.baseURL, storageState })
  const page: Page = await context.newPage()
  const stamp = `${Date.now()}`
  const title = `First touch ${stamp}`
  const edited = `${title} edited`

  await page.goto('/admin/post')
  await page.waitForLoadState('networkidle')
  await page.click('text=/create|new/i')
  await page.waitForLoadState('networkidle')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="slug"]', `first-touch-${stamp}`)
  await page.fill('textarea[name="content"]', 'content')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/admin\/post$/, { timeout: 30_000 })

  await page.goto(`/admin/post?search=${stamp}`)
  await page
    .getByRole('row', { name: new RegExp(title) })
    .locator('[data-slot="row-title-link"]')
    .click()
  await page.waitForLoadState('networkidle')
  await page.fill('input[name="title"]', edited)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/admin\/post$/, { timeout: 30_000 })

  await page.goto(`/admin/post?search=${stamp}`)
  await page.getByRole('button', { name: `Actions for ${edited}` }).click()
  await page.getByRole('menuitem', { name: 'Publish now' }).click()
  await expect(page.locator('[data-slot="selection-status"]')).toContainText('Post published', {
    timeout: 30_000,
  })

  await page.getByRole('button', { name: `Actions for ${edited}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('[data-slot="selection-status"]')).toContainText('deleted', {
    timeout: 30_000,
  })
  await expect(page.getByRole('row', { name: new RegExp(edited) })).toHaveCount(0)
  await context.close()
}

for (const { mode, port } of modes) {
  test.describe(`first database touch under ${mode}`, () => {
    test.describe.configure({ mode: 'serial', timeout: 300_000 })

    for (const order of orders) {
      test(`${order}, then update, delete and a row action`, async ({ browser }) => {
        test.skip(!canStartFreshApp(mode), 'next dev needs a Postgres named by DATABASE_URL')
        const app = await startFreshApp(mode, port)
        try {
          const user = generateTestUser()
          if (order === 'page-first') {
            const probe = await browser.newContext({ baseURL: app.baseURL })
            const page = await probe.newPage()
            await page.goto('/admin')
            await probe.close()
          }
          const api = await signUpThroughRouteHandler(app, user)
          await adminWritesAndRowAction(browser, app, await api.storageState())
          await api.dispose()
        } finally {
          await app.stop()
        }
      })
    }
  })
}
