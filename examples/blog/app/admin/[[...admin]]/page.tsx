import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'

/**
 * This example wires in no auth provider, so the admin signs in as the first
 * user in the directory. That is enough of a session for the rules in
 * `opensaas.config.ts` to be visible here: the signed-in user can create posts
 * and can edit and read `internalNotes` on the ones they author, and not on
 * anyone else's. With an empty directory there is no session and the admin can
 * do the one thing an anonymous caller may — create a user.
 *
 * Replace this with your own session lookup; `@opensaas/stack-auth` is the
 * supported one (see `examples/auth-demo`).
 */
async function demoSession() {
  const anonymous = await getContext()
  const first = await anonymous.db.User.orderBy({ createdAt: 'asc' }).select('id').first()
  return first === null ? undefined : { userId: first.id }
}

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext(await demoSession())
  return await context.serverAction(props)
}

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Main admin interface using catch-all route
 * Handles all admin routes: /admin, /admin/Post, /admin/Post/create, /admin/Post/[id]
 */
export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  return (
    <AdminUI
      context={await getContext(await demoSession())}
      config={await config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
