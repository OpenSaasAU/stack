import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import config from '../../../opensaas.config'
import { getContext } from '@/.opensaas/context'

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  'use server'
  const context = getContext()
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
  const adminContext = getContext()

  return (
    <AdminUI
      context={adminContext}
      config={config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
