// Browser-safe stub for `next/link`, used only when bundling @opensaas/stack-ui
// for claude.ai/design previews (wired via cfg.tsconfig → next-stub-tsconfig.json).
// Renders a plain anchor so Link-using components display outside a Next app.
import * as React from 'react'

type LinkProps = Omit<React.ComponentPropsWithoutRef<'a'>, 'href'> & {
  href?: string | { pathname?: string }
  prefetch?: boolean | null
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  locale?: string | false
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch, replace, scroll, shallow, passHref, locale, children, ...rest },
  ref,
) {
  const resolved = typeof href === 'string' ? href : (href?.pathname ?? '#')
  return React.createElement('a', { ref, href: resolved, ...rest }, children)
})

export default Link
