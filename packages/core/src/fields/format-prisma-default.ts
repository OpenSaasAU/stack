/**
 * Field types that {@link formatPrismaDefault} knows how to serialise.
 *
 * Kept narrow on purpose: only the scalar fields whose `defaultValue` maps to a
 * Prisma `@default(...)` literal via this shared helper. Other fields (e.g.
 * `checkbox`, `decimal`, `timestamp`) format their own defaults inline because
 * their literal forms diverge (`@default(now())`, bare booleans, etc.).
 */
export type PrismaDefaultFieldType = 'text' | 'integer' | 'json'

/**
 * Serialise a field's `defaultValue` into the inner literal of a Prisma
 * `@default(...)` attribute.
 *
 * Pure: no I/O, no field-builder coupling. Returns just the literal (the caller
 * wraps it in `@default(...)`), so it composes with whatever modifier string a
 * field builder assembles. Returns `undefined` when there is nothing to emit, so
 * a field with no `defaultValue` produces no `@default(...)` at all.
 *
 * Serialisation rules (Keystone 6 compatible):
 * - `integer` → bare numeric literal, e.g. `3550` → `@default(3550)`.
 * - `text` → double-quoted string literal, e.g. `PLEASE_UPDATE` → `@default("PLEASE_UPDATE")`.
 * - `json` → Keystone's JSON-literal form: `JSON.stringify` the value with no
 *   extra whitespace, then wrap the result in escaped double quotes, e.g.
 *   `[1,2,3,4,5]` → `@default("[1,2,3,4,5]")` and `[]` → `@default("[]")`.
 *
 * Nullability (the `?` modifier) is the caller's concern and is handled
 * independently of the default — this function never touches it.
 *
 * @param value - The configured `defaultValue` (the field builder's `defaultValue`).
 * @param fieldType - The field's discriminator, selecting the serialisation rule.
 * @returns The literal to place inside `@default(...)`, or `undefined` when
 *   `value` is `undefined` (no default to emit).
 */
export function formatPrismaDefault(
  value: unknown,
  fieldType: PrismaDefaultFieldType,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  switch (fieldType) {
    case 'integer':
      return String(value)

    case 'text':
      // JSON.stringify (not a template literal) so embedded quotes/backslashes
      // in the value are escaped correctly.
      return JSON.stringify(String(value))

    case 'json': {
      // Double JSON.stringify: once to canonicalize the value as JSON text,
      // again to wrap that text in an escaped, double-quoted Prisma literal.
      const serialised = JSON.stringify(value)
      // JSON.stringify can return undefined for unserialisable values (e.g. a
      // function). Treat that as "no default" rather than emitting `@default()`.
      if (serialised === undefined) {
        return undefined
      }
      return JSON.stringify(serialised)
    }
  }
}
