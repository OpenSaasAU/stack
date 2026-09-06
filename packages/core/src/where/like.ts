/**
 * The engine's LIKE-pattern escaping. One escaper, engine-owned: the secured
 * surface's Where vocabulary and the Auth adapter both lower substring
 * predicates to `like`/`ilike`, and a second implementation is a second set of
 * edge cases (ADR-0055, ADR-0060).
 */

/**
 * The escape character every pattern this module builds is written against.
 *
 * PostgreSQL's `LIKE` defaults to a backslash when the statement carries no
 * `ESCAPE` clause, and neither Prisma's ORM lane nor its SQL builder emits
 * one — the pattern travels as a bound parameter. So the patterns below must
 * be backslash-escaped, and a caller writing its own `ESCAPE` clause must
 * name this character.
 */
export const LIKE_ESCAPE_CHARACTER = '\\'

/**
 * Escape the `LIKE` metacharacters in a literal so it matches itself.
 *
 * Wildcards a caller adds around the result stay wildcards; `%` and `_` inside
 * `value` become literal, and the escape character escapes itself.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** `value` as a `LIKE` pattern matching it exactly — the pattern for an insensitive equality. */
export function likeEqualsPattern(value: string): string {
  return escapeLikeLiteral(value)
}

/** `value` as a `LIKE` pattern matching anywhere in the column. */
export function likeContainsPattern(value: string): string {
  return `%${escapeLikeLiteral(value)}%`
}

/** `value` as a `LIKE` pattern anchored to the start of the column. */
export function likeStartsWithPattern(value: string): string {
  return `${escapeLikeLiteral(value)}%`
}

/** `value` as a `LIKE` pattern anchored to the end of the column. */
export function likeEndsWithPattern(value: string): string {
  return `%${escapeLikeLiteral(value)}`
}
