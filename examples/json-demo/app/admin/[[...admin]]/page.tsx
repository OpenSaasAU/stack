import { AdminUI } from '@opensaas/stack-ui'
import { getContext, config } from '@/.opensaas/context'
import '@/lib/register-fields'
import { ServerActionInput } from '@opensaas/stack-ui/server'

// User-defined wrapper function for server actions
async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext()
  return await context.serverAction(props)
}
interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  return (
    <AdminUI
      context={await getContext()}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      config={await config}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
