// Browser-safe stub for `next/navigation`, used only when bundling
// @opensaas/stack-ui for claude.ai/design previews. Router methods are no-ops
// (navigation happens in event handlers, so components render fine).
type Router = {
  push: (href: string) => void
  replace: (href: string) => void
  refresh: () => void
  back: () => void
  forward: () => void
  prefetch: (href: string) => void
}

const noop = (): void => {}

export function useRouter(): Router {
  return { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop }
}

export function usePathname(): string {
  return '/'
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams()
}

export function useParams(): Record<string, string> {
  return {}
}

export function redirect(_href: string): void {}

export function permanentRedirect(_href: string): void {}

export function notFound(): void {}
