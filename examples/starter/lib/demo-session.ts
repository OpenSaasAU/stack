import { getContext } from '@/.opensaas/context'

/**
 * This example wires in no auth provider, so it acts as the first user in the
 * directory. That is enough of a session for the rules in `opensaas.config.ts`
 * to apply throughout: a signed-in caller sees drafts and creates posts, and
 * only a post's author updates it, deletes it, or reads its `internalNotes`.
 * With an empty directory there is no session: create a user in `/admin` (the
 * one thing an anonymous caller may do) and every page acts as that user.
 *
 * In a real app this comes from your auth session — `@opensaas/stack-auth` is
 * the supported one (see `examples/auth-demo`).
 */
export async function demoSession(): Promise<{ userId: string } | undefined> {
  const anonymous = await getContext()
  const first = await anonymous.db.User.orderBy({ id: 'asc' }).select('id').first()
  return first === null ? undefined : { userId: first.id }
}
