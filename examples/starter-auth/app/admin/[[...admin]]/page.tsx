import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getUrlKey } from '@opensaas/stack-core'

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  'use server'
  const session = await getSession()
  const context = await getContext(session ?? undefined)

  try {
    const result = await context.serverAction(props)
    return result
  } catch (error) {
    // Handle validation errors from hooks
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
      const validationError = error as { message: string }
      throw new Error(validationError.message)
    }

    // Handle Prisma unique constraint violations (P2002)
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002' &&
      'meta' in error
    ) {
      const meta = error.meta as { target?: string[] }
      const field = meta.target?.[0] || 'field'
      throw new Error(`A record with this ${field} already exists. Please use a unique value.`)
    }

    // Re-throw other errors
    throw error
  }
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
  if (!session) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">Access Denied</h2>
          <p>You must be logged in to access the admin interface.</p>
        </div>
      </div>
    )
  }
  return (
    <AdminUI
      context={await getContext(session)}
      config={await config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
