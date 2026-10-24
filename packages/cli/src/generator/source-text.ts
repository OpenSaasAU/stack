import type { OpenSaasConfig } from '@opensaas/stack-core'

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * A single-quoted TypeScript string, matching the repo's own source style.
 *
 * All four ECMAScript LineTerminators are escaped: an unescaped one inside a
 * single-quoted literal ends it, so a `\r` or a U+2028/U+2029 in a user's
 * value would otherwise write a module that will not parse. This is not
 * `JSON.stringify`, which leaves U+2028 and U+2029 raw — legal in JSON,
 * fatal in a JavaScript string literal.
 */
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `'${escaped}'`
}

/** A TypeScript object key, quoted only when it is not a plain identifier. */
export function key(name: string): string {
  return IDENTIFIER.test(name) ? name : quote(name)
}

export function assertFieldKeysAreIdentifiers(config: OpenSaasConfig): void {
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const fieldName of Object.keys(listConfig.fields)) {
      if (!IDENTIFIER.test(fieldName)) {
        throw new Error(
          `List "${listName}", field "${fieldName}": a field key must be a valid ` +
            'JavaScript identifier (letters, digits, "_" and "$", not starting with a digit).',
        )
      }
    }
  }
}
