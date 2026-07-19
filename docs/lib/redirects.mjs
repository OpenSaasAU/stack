/**
 * Permanent redirects from the pre-Diátaxis docs URLs (ADR-0019).
 * Extend this table — never prune it — if pages move again: URLs that have
 * been published (README, external links, agents) must keep resolving.
 *
 * Shared by `next.config.js` (served as HTTP 308s) and
 * `scripts/link-check.ts` (asserts every source maps to a real page).
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const DOC_REDIRECTS = [
  // Getting started
  ['/docs/quick-start', '/docs/tutorials/quick-start'],
  ['/docs/getting-started', '/docs/how-to/installation'],
  // Core concepts → concepts
  ['/docs/core-concepts/access-control', '/docs/concepts/access-control'],
  ['/docs/core-concepts/field-types', '/docs/concepts/field-types'],
  ['/docs/core-concepts/fields', '/docs/concepts/field-types'],
  ['/docs/core-concepts/queries', '/docs/concepts/queries'],
  ['/docs/core-concepts/hooks', '/docs/concepts/hooks'],
  ['/docs/core-concepts/generators', '/docs/concepts/generators'],
  ['/docs/core-concepts/config', '/docs/concepts/config'],
  // Guides → how-to
  ['/docs/guides/migrating-from-keystone', '/docs/how-to/migrate-from-keystone'],
  ['/docs/guides/migration', '/docs/how-to/migrate'],
  ['/docs/guides/claude-code', '/docs/how-to/claude-code'],
  ['/docs/guides/custom-fields', '/docs/how-to/custom-fields'],
  ['/docs/guides/theming', '/docs/how-to/theming'],
  ['/docs/guides/theme-presets', '/docs/how-to/theme-presets'],
  ['/docs/guides/storage-setup', '/docs/how-to/storage'],
  ['/docs/guides/composability', '/docs/how-to/composability'],
  ['/docs/guides/authentication', '/docs/how-to/authentication'],
  ['/docs/guides/plugins', '/docs/how-to/write-a-plugin'],
  ['/docs/guides/mcp-setup', '/docs/how-to/mcp'],
  ['/docs/guides/rag-setup', '/docs/how-to/rag'],
  ['/docs/guides/rag-advanced', '/docs/how-to/rag-advanced'],
  ['/docs/guides/deployment', '/docs/how-to/deploy'],
  // Packages + API reference → reference
  ['/docs/packages/core', '/docs/reference/core'],
  ['/docs/packages/auth', '/docs/reference/auth'],
  ['/docs/packages/rag', '/docs/reference/rag'],
  ['/docs/packages/storage', '/docs/reference/storage'],
  ['/docs/packages/ui', '/docs/reference/ui'],
  ['/docs/packages/tiptap', '/docs/reference/tiptap'],
  ['/docs/api-reference/config', '/docs/reference/config-api'],
  ['/docs/api-reference/fields', '/docs/reference/fields-api'],
  ['/docs/api-reference/context', '/docs/reference/context-api'],
]
