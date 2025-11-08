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
  return await context.serverAction(props)
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
