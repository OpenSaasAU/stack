import Link from 'next/link.js'
import { Plus } from 'lucide-react'
import { ListViewClient } from './ListViewClient.js'
import { formatListName } from '../lib/utils.js'
import { serializeFieldConfigs } from '../lib/serializeFieldConfig.js'
import { PageHeader } from './PageHeader.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AccessContext,
  type AccessControl,
  buildListFilterWhere,
  collectFilterSuggestions,
  getDbKey,
  getItemLabel,
  getLabelFieldName,
  getUrlKey,
  OpenSaasConfig,
} from '@opensaas/stack-core'

/**
 * Whether the list's delete access is NOT statically false (issue #733).
 *
 * "Statically false" means we can prove no session can ever delete without
 * running a session-dependent function: delete access is absent (deny by
 * default) or the literal boolean `false`. A function — or `true` — can't be
 * evaluated up front, so Delete is offered and per-row Silent failure absorbs
 * any denials into the "N of M deleted" report.
 */
function canDeleteList(deleteAccess: AccessControl | boolean | undefined): boolean {
  if (deleteAccess === undefined) return false
  if (typeof deleteAccess === 'boolean') return deleteAccess
  return true
}

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
  /**
   * The generic server action (rebuilds the session context server-side).
   * Threaded to the client table for the built-in Bulk action Delete. When
   * omitted, no bulk delete is offered.
   */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
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
  serverAction,
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

    // Parse the URL filter query into a server-side `where` fragment via the
    // filter engine (ADR-0017). Field-scoped tokens, comparisons, quoted values
    // and bare-word free text are all driven by each field's Filter spec — no
    // hard-coded `type === 'text'` search here. The fragment is handed to the
    // secured `context.db` below, which ANDs it with the access filter, so the
    // filter can only ever narrow (never widen) what this session may see.
    const where =
      search && search.trim()
        ? buildListFilterWhere(search, listConfig, listKey, config)
        : undefined

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

  // Collect each filterable field's serializable Filter spec metadata (fields,
  // operators, enumerated values / relationship label search) to drive the
  // Filter builder's pickers. This carries no functions, so it crosses the
  // server/client boundary; it mirrors the same specs the server-side
  // `buildListFilterWhere` above uses, so the builder can only produce queries
  // the engine understands.
  const filterSuggestions = collectFilterSuggestions(listConfig, listKey, config)

  // When the list opts into avatars (issue #735), the label column renders with
  // an initials bubble ahead of the emphasized Item label. The label column is
  // resolved through the shared label seam (`getLabelFieldName`), so it can
  // never drift from the field the Item label is read off. A per-field cell
  // override on that field still wins — the client routes to the override first.
  const avatarColumn = listConfig.ui?.avatar ? getLabelFieldName(listConfig) : undefined

  return (
    <div className="p-8">
      <PageHeader
        title={formatListName(listKey)}
        description={`${total} ${total === 1 ? 'item' : 'items'}`}
        actions={
          <Button asChild>
            <Link href={`${basePath}/${urlKey}/create`}>
              <Plus aria-hidden="true" />
              Create {formatListName(listKey)}
            </Link>
          </Button>
        }
      />

      {/* Client Table */}
      <ListViewClient
        items={serializedItems || []}
        fieldTypes={Object.fromEntries(
          Object.entries(listConfig.fields).map(([key, field]) => [
            key,
            (field as { type: string }).type,
          ]),
        )}
        fields={serializeFieldConfigs(listConfig.fields)}
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
        filterSuggestions={filterSuggestions}
        serverAction={serverAction}
        canDelete={canDeleteList(listConfig.access?.operation?.delete)}
        avatarColumn={avatarColumn}
      />
    </div>
  )
}
