/**
 * `.ts` (not extensionless or `.js`) because the Generated bundle's relative
 * imports must resolve identically under plain Node, `tsx`, esbuild, and
 * webpack without a consumer-side `extensionAlias` — `.ts` is the only
 * specifier that works everywhere, since it names the literal on-disk file.
 * See ADR-0008.
 */
const TS_EXTENSION = '.ts'

/** Module specifiers that already carry an explicit extension we should not touch. */
const EXPLICIT_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/

export function withTsExtension(specifier: string): string {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (!isRelative) return specifier
  if (EXPLICIT_EXTENSION.test(specifier)) return specifier
  return `${specifier}${TS_EXTENSION}`
}
