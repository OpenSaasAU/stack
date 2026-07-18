import { Badge } from '@opensaas/stack-ui/primitives'

/**
 * Maps a post's status onto the design-system status tokens (issue #709).
 *
 * Published → `success`, everything else (draft / unset) → `warning`. No
 * hardcoded status colours — the shared `Badge` primitive renders the token
 * variants so the custom dashboard matches the prebuilt admin's status
 * rendering.
 */
export function PostStatusBadge({ status }: { status: string | null }) {
  return <Badge variant={status === 'published' ? 'success' : 'warning'}>{status ?? 'draft'}</Badge>
}
