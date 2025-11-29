import Link from 'next/link.js'
import { ListViewClient } from './ListViewClient.js'
import { formatListName } from '../lib/utils.js'
import {
  type AccessContext,
  getDbKey,
  getUrlKey,
  OpenSaasConfig,
  type PrismaClientLike,
} from '@opensaas/stack-core'

export interface ListViewProps {
  context: AccessContext<any>
  config: OpenSaasConfig
  listKey: string
  basePath?: string
  columns?: string[]
  page?: number
  pageSize?: number
  search?: string
}

/**
 * List view component - displays items in a table
 * Server Component that fetches data and renders client table
 */
export async function ListView({
  context,
  config,
  listKey,
  basePath = '/admin',
  columns,
  page = 1,
  pageSize = 50,
  search,
}: ListViewProps) {
  const key = getDbKey(listKey)
  const urlKey = getUrlKey(listKey)
  const listConfig = config.lists[listKey]

  if (!listConfig) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">List not found</h2>
          <p>The list &quot;{listKey}&quot; does not exist in your configuration.</p>
        </div>
      </div>
    )
  }

  // Fetch items using access-controlled context
  const skip = (page - 1) * pageSize
  let items: Array<Record<string, unknown>> = []
  let total = 0

  try {
    const dbContext = context.db
    if (!dbContext || !dbContext[key]) {
      throw new Error(`Context for ${listKey} not found`)
    }

    // Build search filter if search term provided
    let where: Record<string, unknown> | undefined = undefined
    if (search && search.trim()) {
      // Find all text fields to search across
      const searchableFields = Object.entries(listConfig.fields)
        .filter(([_, field]) => (field as { type: string }).type === 'text')
        .map(([fieldName]) => fieldName)

      if (searchableFields.length > 0) {
        where = {
          OR: searchableFields.map((fieldName) => ({
            [fieldName]: {
              contains: search.trim(),
            },
          })),
        }
      }
    }

    // Build include object for relationship fields
    const include: Record<string, boolean> = {}
    Object.entries(listConfig.fields).forEach(([fieldName, field]) => {
      if ((field as { type: string }).type === 'relationship') {
        include[fieldName] = true
      }
    })
    const delegate = dbContext[key]
    if (delegate?.findMany && delegate?.count) {
      ;[items, total] = await Promise.all([
        delegate.findMany({
          where,
          skip,
          take: pageSize,
          ...(Object.keys(include).length > 0 ? { include } : {}),
        }),
        delegate.count({ where }),
      ])
    }
  } catch (error) {
    console.error(`Failed to fetch ${listKey}:`, error)
  }

  // Serialize items for client component (convert Dates, etc to JSON-safe format)
  const serializedItems = JSON.parse(JSON.stringify(items))

  // Extract only the relationship refs needed by client (don't send entire config)
  const relationshipRefs: Record<string, string> = {}
  Object.entries(listConfig.fields).forEach(([fieldName, field]) => {
    if ('type' in field && field.type === 'relationship' && 'ref' in field && typeof field.ref === 'string') {
      relationshipRefs[fieldName] = field.ref
    }
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{formatListName(listKey)}</h1>
          <p className="text-muted-foreground">
            {total} {total === 1 ? 'item' : 'items'}
          </p>
        </div>
        <Link
          href={`${basePath}/${urlKey}/create`}
          className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
        >
          <span className="mr-2">+</span>
          Create {formatListName(listKey)}
        </Link>
      </div>

      {/* Client Table */}
      <ListViewClient
        items={serializedItems || []}
        fieldTypes={Object.fromEntries(
          Object.entries(listConfig.fields).map(([key, field]) => [
            key,
            (field as { type: string }).type,
          ]),
        )}
        relationshipRefs={relationshipRefs}
        columns={columns}
        listKey={listKey}
        urlKey={urlKey}
        basePath={basePath}
        page={page}
        pageSize={pageSize}
        total={total || 0}
        search={search}
      />
    </div>
  )
}
