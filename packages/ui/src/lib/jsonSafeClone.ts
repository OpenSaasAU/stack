/**
 * JSON round-trip so only serialisable data crosses the server/client
 * component boundary. Behaves exactly like `JSON.parse(JSON.stringify(value))`,
 * except a `bigint` (e.g. a `bigInt()` field's value) round-trips back to a
 * `bigint` instead of making `JSON.stringify` throw
 * (`TypeError: Do not know how to serialize a BigInt`).
 *
 * A `bigInt()` field's TypeScript type is `bigint` on both sides of this
 * boundary (ADR-0029) — the tagged-object encoding is an implementation
 * detail of this one round-trip, never observed by field or component code.
 */
export function jsonSafeClone<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val: unknown) =>
      typeof val === 'bigint' ? { $bigint: val.toString() } : val,
    ),
    (_key, val: unknown) => {
      if (val && typeof val === 'object' && '$bigint' in val && Object.keys(val).length === 1) {
        const wrapped = (val as { $bigint: unknown }).$bigint
        if (typeof wrapped === 'string') return BigInt(wrapped)
      }
      return val
    },
  ) as T
}
