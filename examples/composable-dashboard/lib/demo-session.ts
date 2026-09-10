import { getContext } from '@/.opensaas/context'

/**
 * This example wires in no auth provider, so it acts as the first user in the
 * directory. That is enough of a session for the rules in `opensaas.config.ts`
 * to apply throughout: a signed-in caller sees drafts and creates posts, and
 * only a post's author updates it, deletes it, or reads its `internalNotes`.
 * `pnpm seed` puts that user there; with an empty directory there is no
 * session and every page reads as an anonymous visitor would.
 *
 * In a real app this comes from your auth session — `@opensaas/stack-auth` is
 * the supported one (see `examples/auth-demo`).
 */
export async function demoSession(): Promise<{ userId: string } | undefined> {
  const anonymous = await getContext()
  const first = await anonymous.db.User.orderBy({ createdAt: 'asc' }).select('id').first()
  return first === null ? undefined : { userId: first.id }
}
