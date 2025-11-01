import { AdminUI } from '@opensaas/stack-ui'
import { getContext } from '@/.opensaas/context'
import config from '@/opensaas.config'
import { ServerActionInput } from '@opensaas/stack-ui/server'

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

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const context = getContext()

  return (
    <AdminUI
      context={context}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      config={config}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
