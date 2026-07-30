/**
 * Derives the admin's `currentPath` (used for nav active-state highlighting)
 * from the route params array `AdminUI` receives. Exported (ADR-0021) so
 * host-owned chrome computing active state shares this one rule instead of
 * re-deriving it.
 */
export function deriveCurrentPath(params: string[] = []): string {
  return params.length > 0 ? `/${params.join('/')}` : ''
}
