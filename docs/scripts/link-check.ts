/**
 * Documentation link-check
 *
 * Two jobs:
 *
 *   1. Assert that a set of "must resolve" doc paths exist as real pages.
 *      These are paths referenced from external docs, agents, and the CLI that
 *      previously 404'd (see issue #487). If any of them goes missing, fail.
 *
 *   2. Walk the migration docs and flag any internal `/docs/...` link that
 *      points at a page that does not exist, so broken cross-references don't
 *      silently regress.
 *
 * Run with: `pnpm --filter opensaas-stack-docs link-check`
 * (or directly: `tsx scripts/link-check.ts`)
 *
 * Exits non-zero on any failure so it can gate CI / the docs build.
 */

import { getAllDocSlugs, getDocBySlug } from '../lib/content.js'

/**
 * Doc paths that MUST resolve. Expressed as the slug array the docs route uses
 * (i.e. everything after `/docs/`). These are the previously-404 paths from
 * issue #487 plus the canonical targets they depend on.
 */
const MUST_RESOLVE: ReadonlyArray<readonly string[]> = [
  ['guides', 'migrating-from-keystone'],
  ['core-concepts', 'queries'],
  ['core-concepts', 'fields'],
  // Canonical targets the above pages link to — keep them honest too.
  ['guides', 'migration'],
  ['core-concepts', 'field-types'],
]

/**
 * Docs whose internal links we lint for breakage. These are the migration
 * surface — the pages most likely to reference paths that move or 404.
 */
const LINK_CHECK_DOCS: ReadonlyArray<readonly string[]> = [
  ['guides', 'migration'],
  ['guides', 'migrating-from-keystone'],
  ['core-concepts', 'queries'],
  ['core-concepts', 'fields'],
]

/** Build a fast lookup of every slug the site can render. */
function buildSlugSet(): Set<string> {
  const set = new Set<string>()
  for (const slug of getAllDocSlugs()) {
    set.add(slug.join('/'))
  }
  return set
}

/**
 * Extract internal doc links from markdown.
 *
 * Matches markdown links `[text](href)` where href is an internal `/docs/...`
 * path. External URLs (http/https/mailto) and same-page anchors (`#...`) are
 * ignored. Any `#fragment` on an internal link is stripped before resolution
 * (we only verify the page exists, not the heading anchor).
 */
function extractInternalDocLinks(markdown: string): string[] {
  const links: string[] = []
  const linkRegex = /\[[^\]]*\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(markdown)) !== null) {
    const href = match[1].trim()
    if (href.startsWith('/docs/')) {
      links.push(href)
    }
  }
  return links
}

/** Turn `/docs/core-concepts/queries#anchor` into the slug `core-concepts/queries`. */
function hrefToSlug(href: string): string {
  const withoutFragment = href.split('#')[0]
  const withoutQuery = withoutFragment.split('?')[0]
  return withoutQuery.replace(/^\/docs\//, '').replace(/\/$/, '')
}

function main(): void {
  const slugSet = buildSlugSet()
  const errors: string[] = []

  // ── 1. Must-resolve paths ────────────────────────────────────────────────
  for (const slug of MUST_RESOLVE) {
    const key = slug.join('/')
    if (!slugSet.has(key) || getDocBySlug([...slug]) === null) {
      errors.push(`Missing required doc page: /docs/${key}`)
    }
  }

  // ── 2. Broken internal links in the migration docs ───────────────────────
  for (const docSlug of LINK_CHECK_DOCS) {
    const doc = getDocBySlug([...docSlug])
    if (doc === null) {
      // Covered by the must-resolve check above if it's required; skip here.
      continue
    }
    const fromKey = docSlug.join('/')
    for (const href of extractInternalDocLinks(doc.content)) {
      const targetSlug = hrefToSlug(href)
      if (targetSlug === '') continue // bare `/docs/` → home, always valid
      if (!slugSet.has(targetSlug)) {
        errors.push(
          `Broken internal link in /docs/${fromKey}: ${href} → /docs/${targetSlug} does not exist`,
        )
      }
    }
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
    `✓ Docs link-check passed: ${MUST_RESOLVE.length} required pages resolve, ` +
      `internal links in ${LINK_CHECK_DOCS.length} migration docs are valid.`,
  )
}

main()
