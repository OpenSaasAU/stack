import type { Page } from '@playwright/test'

/**
 * Click a form's submit button and resolve once the server action it posts
 * has responded. Next.js sends that response only after the action resolves,
 * so the write is committed; `networkidle` can settle before the request starts.
 * Don't await the body: the form's own `router.push` aborts it.
 */
export async function submitAndAwaitServerAction(
  page: Page,
  selector = 'button[type="submit"]',
): Promise<void> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      candidate.request().headers()['next-action'] !== undefined,
  )
  await page.click(selector)
  await response
}
