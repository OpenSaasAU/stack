export const MISSING_BASE_URL_MESSAGE = 'Auth base URL is not configured. Set BETTER_AUTH_URL.'

export function hasAuthBaseURL(): boolean {
  return Boolean(process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL)
}
