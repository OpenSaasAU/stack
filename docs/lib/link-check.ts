import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Markdoc from '@markdoc/markdoc'
import { collectHeadings } from './markdoc.js'

export interface LinkCheckEnv {
  slugSet: ReadonlySet<string>
  redirects: ReadonlyMap<string, string>
  publicDir: string
  getContent: (slug: string) => string | null
}

export interface LinkFindings {
  errors: string[]
  warnings: string[]
}

export function stripFences(content: string): string {
  return content.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '')
}

export function hrefToSlug(href: string): string {
  const withoutFragment = href.split('#')[0]
  const withoutQuery = withoutFragment.split('?')[0]
  return withoutQuery.replace(/^\/docs(\/|$)/, '').replace(/\/$/, '')
}

function extractLinks(markdown: string): string[] {
  const links: string[] = []
  for (const match of stripFences(markdown).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].trim().split(/\s+/)[0]
    if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))) links.push(href)
  }
  return links
}

function fragmentProblem(content: string, fragment: string): 'missing' | 'ambiguous' | null {
  const headings = collectHeadings(Markdoc.parse(content))
  if (headings.some((h) => h.explicit && h.id === fragment)) return null
  if (headings.filter((h) => !h.explicit && h.base === fragment).length > 1) return 'ambiguous'
  return headings.some((h) => h.id === fragment) ? null : 'missing'
}

export function checkPageLinks(fromKey: string, markdown: string, env: LinkCheckEnv): LinkFindings {
  const errors: string[] = []
  const warnings: string[] = []
  const check = (href: string, content: string | null, where: string): void => {
    const fragment = href.includes('#') ? href.split('#')[1] : ''
    if (fragment === '' || content === null) return
    const problem = fragmentProblem(content, fragment)
    if (problem === 'missing') errors.push(`Broken anchor in /docs/${fromKey}: ${href}`)
    if (problem === 'ambiguous')
      errors.push(
        `Ambiguous anchor in /docs/${fromKey}: ${href} — ${where} has several "${fragment}" headings; link the suffixed id or give the heading an explicit id`,
      )
  }

  for (const href of extractLinks(markdown)) {
    if (href.startsWith('#')) {
      check(href, markdown, 'this page')
      continue
    }
    const target = href.split('#')[0].split('?')[0]
    if (!(href.startsWith('/docs/') || href === '/docs')) {
      if (!existsSync(join(env.publicDir, target)) || target.split('/').includes('..')) {
        errors.push(`Broken root-relative link in /docs/${fromKey}: ${href}`)
      }
      continue
    }
    const targetSlug = hrefToSlug(href)
    if (targetSlug === '') continue
    if (env.slugSet.has(targetSlug)) {
      check(href, env.getContent(targetSlug), `/docs/${targetSlug}`)
      continue
    }
    const redirect = env.redirects.get(target)
    if (redirect !== undefined) {
      warnings.push(`Redirected internal link in /docs/${fromKey}: ${href} — update to ${redirect}`)
      continue
    }
    errors.push(
      `Broken internal link in /docs/${fromKey}: ${href} → /docs/${targetSlug} does not exist`,
    )
  }
  return { errors, warnings }
}
