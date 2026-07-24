/**
 * Strip better-call's `[body.field]` validation prefixes from an auth error
 * message so forms can display something user-friendly.
 *
 * Better-auth surfaces validation errors like `[body.password] Password is too
 * short`. This removes those bracketed prefixes and normalises whitespace,
 * falling back to a default when the message is empty or missing.
 *
 * Internal to the auth forms — not part of the package's public contract.
 */
export function cleanAuthErrorMessage(
  message: string | null | undefined,
  fallback = 'Something went wrong',
): string {
  if (!message) return fallback
  const cleaned = message
    .replace(/\[body\.\w+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}
