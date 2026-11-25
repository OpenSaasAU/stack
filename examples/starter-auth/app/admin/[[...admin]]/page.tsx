import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'
import { signOutAction } from '@/lib/actions/auth'
import { redirect } from 'next/navigation'
import { getUrlKey } from '@opensaas/stack-core'

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  'use server'
  const session = await getSession()
  const context = await getContext(session ?? undefined)
  const result = await context.serverAction(props)

  // Redirect after successful operations
  if (result && typeof result === 'object' && 'success' in result && result.success) {
    const listUrl = `/admin/${getUrlKey(props.listKey)}`
    redirect(listUrl)
  }

  return result
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
  const session = await getSession()
  if (!session) redirect('/sign-in')
  return (
    <AdminUI
      context={await getContext(session)}
      config={await config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
      onSignOut={signOutAction}
    />
  )
}
