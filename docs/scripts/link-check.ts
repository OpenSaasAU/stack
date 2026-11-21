/**
 * Documentation link-check
 *
 * Three jobs:
 *
 *   1. Assert that a set of "must resolve" doc paths reach a real page —
 *      either directly as content or via the permanent redirect table
 *      (lib/redirects.mjs, ADR-0019). These are paths referenced from
 *      external docs, agents, and the CLI that previously 404'd (issue #487):
 *      published URLs must never stop resolving.
 *
 *   2. Assert every redirect in the table lands on a page that exists
 *      (directly or via one more redirect hop).
 *
 *   3. Walk EVERY content page and flag any internal `/docs/...` link that
 *      points at a page that neither exists nor redirects, so broken
 *      cross-references don't silently regress. Links into the redirect
 *      table are reported as warnings — update them to the canonical URL.
 *
 * Run with: `pnpm --filter opensaas-stack-docs link-check`
 * (or directly: `tsx scripts/link-check.ts`)
 *
 * Exits non-zero on any failure so it can gate CI / the docs build.
 */

import { getAllDocSlugs, getDocBySlug } from '../lib/content.js'
import { join } from 'node:path'
import { checkPageLinks, hrefToSlug } from '../lib/link-check.js'
import { DOC_REDIRECTS } from '../lib/redirects.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

/**
 * Doc paths that MUST resolve, expressed as full `/docs/...` paths. The
 * previously-404 paths from issue #487, their canonical targets, and the
 * entry points the site's chrome links to.
 */
const MUST_RESOLVE: ReadonlyArray<string> = [
  // Issue #487 external contract (now redirect sources)
  '/docs/guides/migrating-from-keystone',
  '/docs/core-concepts/queries',
  '/docs/core-concepts/fields',
  '/docs/guides/migration',
  '/docs/core-concepts/field-types',
  // Canonical entry points linked from the landing page and nav
  '/docs/tutorials/quick-start',
  '/docs/tutorials/build-with-claude-code',
  '/docs/how-to/claude-code',
  '/docs/how-to/migrate-from-keystone',
  '/docs/concepts/access-control',
]

/** Build a fast lookup of every slug the site can render. */
function buildSlugSet(): Set<string> {
  const set = new Set<string>()
  for (const slug of getAllDocSlugs()) {
    set.add(slug.join('/'))
  }
  return set
}

const redirectMap = new Map<string, string>(DOC_REDIRECTS)

/** A path resolves if it is content, or redirects (transitively) to content. */
function resolves(path: string, slugSet: Set<string>): boolean {
  let current = path
  for (let hops = 0; hops <= 2; hops++) {
    const slug = hrefToSlug(current)
    if (slug === '') return true // bare `/docs` → docs landing page, always valid
    if (slugSet.has(slug)) return true
    const next = redirectMap.get(current.split('#')[0].split('?')[0])
    if (!next) return false
    current = next
  }
  return false
}

function main(): void {
  const slugSet = buildSlugSet()
  const errors: string[] = []
  const warnings: string[] = []

  // ── 1. Must-resolve paths ────────────────────────────────────────────────
  for (const path of MUST_RESOLVE) {
    if (!resolves(path, slugSet)) {
      errors.push(`Missing required doc page: ${path}`)
    }
  }

  // ── 2. Every redirect lands on a real page ───────────────────────────────
  for (const [source, destination] of DOC_REDIRECTS) {
    if (!resolves(destination, slugSet)) {
      errors.push(`Redirect target does not exist: ${source} → ${destination}`)
    }
  }

  // ── 3. Broken internal links, across all content pages ───────────────────
  for (const docSlug of getAllDocSlugs()) {
    const doc = getDocBySlug(docSlug)
    if (doc === null) continue
    const found = checkPageLinks(docSlug.join('/'), doc.content, {
      slugSet,
      redirects: redirectMap,
      publicDir: PUBLIC_DIR,
      getContent: (slug) => getDocBySlug(slug.split('/'))?.content ?? null,
    })
    errors.push(...found.errors)
    warnings.push(...found.warnings)
  }

  if (warnings.length > 0) {
    console.warn('⚠ Docs link-check warnings:\n')
    for (const warning of warnings) {
      console.warn(`  - ${warning}`)
    }
    console.warn('')
  }

  if (errors.length > 0) {
    console.error('✖ Docs link-check failed:\n')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    console.error(`\n${errors.length} problem(s) found.`)
    process.exit(1)
  }

  console.log(
    `✓ Docs link-check passed: ${MUST_RESOLVE.length} required paths resolve, ` +
      `${DOC_REDIRECTS.length} redirects land, internal links across ` +
      `${getAllDocSlugs().length} pages are valid.`,
  )
}

main()
