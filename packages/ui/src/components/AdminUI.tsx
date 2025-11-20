import * as React from 'react'
import { Navigation } from './Navigation.js'
import { Dashboard } from './Dashboard.js'
import { ListView } from './ListView.js'
import { ItemForm } from './ItemForm.js'
import type { ServerActionInput } from '../server/types.js'
import { AccessContext, getListKeyFromUrl, OpenSaasConfig } from '@opensaas/stack-core'
import { generateThemeCSS } from '../lib/theme.js'

export interface AdminUIProps<TPrisma> {
  context: AccessContext<TPrisma>
  config: OpenSaasConfig
  params?: string[]
  searchParams?: { [key: string]: string | string[] | undefined }
  basePath?: string
  // Server action can return any shape depending on the list item type
  serverAction: (input: ServerActionInput) => Promise<unknown>
  onSignOut?: () => Promise<void>
}

/**
 * Main AdminUI component - complete admin interface with routing
 * Server Component
 *
 * Handles routing based on params array:
 * - [] → Dashboard
 * - [list] → ListView
 * - [list, 'create'] → ItemForm (create)
 * - [list, id] → ItemForm (edit)
 */
export function AdminUI<TPrisma>({
  context,
  config,
  params = [],
  searchParams = {},
  basePath = '/admin',
  serverAction,
  onSignOut,
}: AdminUIProps<TPrisma>) {
  // Parse route from params
  const [urlSegment, action] = params

  // Convert URL segment (kebab-case) to PascalCase listKey
  const listKey = urlSegment ? getListKeyFromUrl(urlSegment) : undefined

  // Determine current path for navigation highlighting
  const currentPath = params.length > 0 ? `/${params.join('/')}` : ''

  // Route to appropriate component
  let content: React.ReactNode

  if (!listKey) {
    // Dashboard
    content = <Dashboard context={context} config={config} basePath={basePath} />
  } else if (action === 'create') {
    // Create form
    content = (
      <ItemForm
        context={context}
        config={config}
        listKey={listKey}
        mode="create"
        basePath={basePath}
        serverAction={serverAction}
      />
    )
  } else if (action && action !== 'create') {
    // Edit form (action is the item ID)
    content = (
      <ItemForm
        context={context}
        config={config}
        listKey={listKey}
        mode="edit"
        itemId={action}
        basePath={basePath}
        serverAction={serverAction}
      />
    )
  } else {
    // List view
    const search = typeof searchParams.search === 'string' ? searchParams.search : undefined
    const page = typeof searchParams.page === 'string' ? parseInt(searchParams.page, 10) : 1

    content = (
      <ListView
        context={context}
        config={config}
        listKey={listKey}
        basePath={basePath}
        search={search}
        page={page}
      />
    )
  }

  // Generate theme styles if custom theme is configured
  const themeStyles = config.ui?.theme ? generateThemeCSS(config.ui.theme) : null

  return (
    <>
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <div className="flex min-h-screen bg-background">
        <Navigation
          context={context}
          config={config}
          basePath={basePath}
          currentPath={currentPath}
          onSignOut={onSignOut}
        />
        <main className="flex-1 overflow-y-auto">{content}</main>
      </div>
    </>
  )
}
