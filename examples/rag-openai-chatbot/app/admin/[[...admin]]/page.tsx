import { AdminUI } from '@opensaas/stack-ui'
import { getContext } from '@/.opensaas/context'
import config from '@/opensaas.config'
import type { ServerActionInput } from '@opensaas/stack-ui/server'

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext()

  try {
    return await context.serverAction(props)
  } catch (error) {
    // Handle validation errors from hooks
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'ValidationError'
    ) {
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
      throw new Error(
        `A record with this ${field} already exists. Please use a unique value.`
      )
    }

    // Re-throw other errors
    throw error
  }
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams

  return (
    <AdminUI
      context={await getContext()}
      config={await config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
