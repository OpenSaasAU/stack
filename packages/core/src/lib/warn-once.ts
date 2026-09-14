const warned = new Set<string>()

/**
 * Log `message` via `console.warn` the first time `key` is seen, and never
 * again for that key. Process-lifetime and shared across every caller, so a
 * key must be specific enough that two unrelated diagnostics never collide.
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}
