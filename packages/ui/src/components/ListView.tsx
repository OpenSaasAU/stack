import Link from 'next/link.js'
import { ListViewClient } from './ListViewClient.js'
import { formatListName } from '../lib/utils.js'
import {
  type AccessContext,
  getDbKey,
  getItemLabel,
  getUrlKey,
  OpenSaasConfig,
} from '@opensaas/stack-core'

/**
 * Resolve a fetched relationship value (the full related record, or `null`)
 * into the `{ id, label }` shape `ListViewClient` renders — computing the
 * label via the shared label seam (`getItemLabel`) so list-page cells never
 * drift from the item form's relationship-option labels.
 */
function toRelationshipLabel(
  value: unknown,
  relatedListConfig: OpenSaasConfig['lists'][string] | undefined,
): { id: string; label: string } | null {
  if (!value || typeof value !== 'object' || !relatedListConfig) return null
  const row = value as Record<string, unknown>
  if (!('id' in row)) return null
  return { id: String(row.id), label: getItemLabel(relatedListConfig, row) }
}

/**
 * Default sort for the list table, mirroring Keystone's `ui.listView.initialSort`.
 * Plain serializable data so it can cross the server/client boundary.
 */
export interface ListViewSort {
  field: string
  direction: 'asc' | 'desc'
}

export interface ListViewProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  listKey: string
  basePath?: string
  columns?: string[]
  page?: number
  pageSize?: number
  search?: string
  /**
   * Default sort from the list's `ui.listView.initialSort` config.
   * Used when no URL sort param is present.
   */
  initialSort?: ListViewSort
  /**
   * Active sort from the `?sort=field:direction` URL param.
   * Takes precedence over `initialSort`.
   */
  sort?: ListViewSort
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
  initialSort,
  sort,
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

  // URL sort takes precedence over config initialSort, but only if the field
  // actually exists on the list — an unknown field would cause Prisma to throw.
  const validatedSort = sort && sort.field in listConfig.fields ? sort : undefined
  const activeSort = validatedSort ?? initialSort

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
      const orderBy = activeSort ? { [activeSort.field]: activeSort.direction } : undefined
      ;[items, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy,
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

  // Extract only the relationship refs needed by client (don't send entire config)
  const relationshipRefs: Record<string, string> = {}
  Object.entries(listConfig.fields).forEach(([fieldName, field]) => {
    if (
      'type' in field &&
      field.type === 'relationship' &&
      'ref' in field &&
      typeof field.ref === 'string'
    ) {
      relationshipRefs[fieldName] = field.ref
    }
  })

  // Resolve each relationship value into { id, label } via the shared label
  // seam before crossing the server/client boundary — ListConfig objects
  // carry functions and can't be passed as props to the client component.
  const itemsWithResolvedLabels = items.map((item) => {
    const resolved: Record<string, unknown> = { ...item }
    for (const [fieldName, ref] of Object.entries(relationshipRefs)) {
      const [relatedListKey] = ref.split('.')
      const relatedListConfig = config.lists[relatedListKey]
      const rawValue = item[fieldName]
      resolved[fieldName] = Array.isArray(rawValue)
        ? rawValue
            .map((row) => toRelationshipLabel(row, relatedListConfig))
            .filter((row): row is { id: string; label: string } => row !== null)
        : toRelationshipLabel(rawValue, relatedListConfig)
    }
    return resolved
  })

  // Serialize items for client component (convert Dates, etc to JSON-safe format)
  const serializedItems = JSON.parse(JSON.stringify(itemsWithResolvedLabels))

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
        initialSort={activeSort}
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
