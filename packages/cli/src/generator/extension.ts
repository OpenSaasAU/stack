/**
 * Explicit-extension helper for the generated `.opensaas/` bundle.
 *
 * Why `.ts` (and not extensionless or `.js`)?
 *
 * The Generated bundle (`context.ts`, `types.ts`, `lists.ts`, and the
 * `prisma-client/**` tree) ships as TypeScript whose
 * relative imports point at real `.ts` files on disk. We emit an explicit
 * extension so the bundle resolves identically under every consumer — and is
 * file-traceable by a host bundler — rather than relying on a TS-aware loader's
 * extensionless guessing (which a plain Node process and an un-aliased webpack
 * both refuse). See ADR-0008.
 *
 * The extension is `.ts` rather than `.js` because the on-disk files ARE `.ts`:
 *
 * | loader                         | `.ts` | `.js` (rewrite alias) |
 * | ------------------------------ | ----- | --------------------- |
 * | plain `node` (strip-types)     |  ✅   |  ❌ ERR_MODULE_NOT_FOUND |
 * | `tsx` / vitest                 |  ✅   |  ✅                   |
 * | esbuild bundle                 |  ✅   |  ✅                   |
 * | webpack (no `extensionAlias`)  |  ✅   |  ❌ Module not found  |
 * | webpack / Next (`.js`→`.ts`)   |  ✅   |  ✅                   |
 *
 * `.ts` is the only specifier that resolves everywhere without a consumer-side
 * `extensionAlias`, because it names the literal file. This matches the
 * `moduleResolution: "bundler"` setting the examples use (which permits
 * importing `.ts` extensions directly). The choice was validated by resolving a
 * fixture mirroring the bundle layout under node strip-types, tsx, esbuild, and
 * webpack with and without `extensionAlias`.
 */
const TS_EXTENSION = '.ts'

/** Module specifiers that already carry an explicit extension we should not touch. */
const EXPLICIT_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/

/**
 * Append the explicit `.ts` extension to a relative module specifier so the
 * Generated bundle resolves under a host bundler / plain Node without an
 * `extensionAlias`. Idempotent: a specifier that already carries an explicit
 * extension is returned unchanged.
 *
 * Only relative specifiers (`./` or `../`) are extended — bare package
 * specifiers (e.g. `@opensaas/stack-core`) are returned untouched.
 */
export function withTsExtension(specifier: string): string {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (!isRelative) return specifier
  if (EXPLICIT_EXTENSION.test(specifier)) return specifier
  return `${specifier}${TS_EXTENSION}`
}
