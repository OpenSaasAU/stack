import Link from 'next/link.js'
import { Plus } from 'lucide-react'
import { ListViewClient } from './ListViewClient.js'
import type { SerializedBulkAction } from './BulkActions.js'
import { formatListName } from '../lib/utils.js'
import { serializeFieldConfigs } from '../lib/serializeFieldConfig.js'
import { withStructuralTimestampDefaults } from '../lib/defaultColumns.js'
import { jsonSafeClone } from '../lib/jsonSafeClone.js'
import { PageHeader } from './PageHeader.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AccessContext,
  type AccessControl,
  type BulkAction,
  buildListFilterWhere,
  collectFilterSuggestions,
  getItemLabel,
  getLabelFieldName,
  getUrlKey,
  isToManyRelationshipField,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import type { FieldConfig, SecuredQuery } from '@opensaas/stack-core'
import { isFieldReadableForPredicate } from '@opensaas/stack-core/internal'

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
 * Resolve the custom Bulk actions (issue #736) an admin may see, into the
 * serialisable metadata the client selection bar renders. Each action's
 * server-side `hasAccess` gate (if any) is evaluated HERE against the live
 * session/context — a denied action is dropped, so its button is never offered
 * (user story 14). Only `key`/`label`/`variant`/`destructive` cross the
 * boundary; `handler`/`hasAccess` stay on the server. The gate is also
 * re-checked on dispatch, so hiding a button is a UX affordance, not the
 * security boundary — the handler always runs through the secured context.
 */
async function resolveVisibleBulkActions(
  actions: BulkAction[] | undefined,
  context: AccessContext,
  listKey: string,
): Promise<SerializedBulkAction[]> {
  if (!actions || actions.length === 0) return []
  const resolved = await Promise.all(
    actions.map(async (action): Promise<SerializedBulkAction | null> => {
      if (action.hasAccess) {
        const allowed = await action.hasAccess({
          session: context.session,
          context,
          listKey,
        })
        if (!allowed) return null
      }
      return {
        key: action.key,
        label: action.label,
        ...(action.variant ? { variant: action.variant } : {}),
        ...(action.destructive ? { destructive: action.destructive } : {}),
      }
    }),
  )
  return resolved.filter((a): a is SerializedBulkAction => a !== null)
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
 * Whether a field can seed an `orderBy` for the list table.
 *
 * `orderBy` takes the list's own scalar columns, so a relationship of either
 * cardinality is excluded — the engine refuses one rather than ignoring it,
 * and a to-many count is not a column it can sort by at all (ADR-0055). A
 * field the session cannot READ is excluded too (#915), evaluated the same
 * predicate-time way the secured read enforces it, so a bookmarked `?sort=`
 * naming either is ignored here rather than throwing downstream.
 */
async function isSortableField(
  field: FieldConfig | undefined,
  args: { session: AccessContext['session']; context: AccessContext },
): Promise<boolean> {
  if (!field) return false
  if (field.virtual === true) return false
  if (field.type === 'relationship') return false
  return isFieldReadableForPredicate(field.access, args)
}

/**
 * Read a to-many relationship's access-scoped count off a fetched row. The
 * native count reducer puts the number at the relation's own key, in place of
 * its rows; a relation the session may not read is absent, which counts 0.
 */
function readRelationshipCount(item: Record<string, unknown>, fieldName: string): number {
  const value = item[fieldName]
  return typeof value === 'number' ? value : 0
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
  context: AccessContext
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
  const key = listKey
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

  // URL sort takes precedence over config initialSort, but only for a
  // sortable field — see `isSortableField`.
  const sortable = async (candidate: ListViewSort | undefined) =>
    candidate &&
    (await isSortableField(listConfig.fields[candidate.field], {
      session: context.session,
      context,
    }))
      ? candidate
      : undefined
  const activeSort = (await sortable(sort)) ?? (await sortable(initialSort))

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
    const parsedWhere =
      search && search.trim()
        ? await buildListFilterWhere(search, listConfig, listKey, config, {
            session: context.session,
            context,
          })
        : undefined

    // A to-one relationship fetches the related row (for its Item label); a
    // to-many reduces to the count of the related rows this session may see,
    // through the surface's own reducer — never the related rows themselves,
    // which would be an unbounded per-row fetch (issue #732).
    const scoped: SecuredQuery = parsedWhere ? dbContext[key].where(parsedWhere) : dbContext[key]
    const withRelations = Object.entries(listConfig.fields).reduce(
      (read, [fieldName, field]) =>
        field.type !== 'relationship'
          ? read
          : isToManyRelationshipField(field)
            ? read.include(fieldName, (rows) => rows.count())
            : read.include(fieldName),
      scoped,
    )

    const sorted = activeSort
      ? withRelations.orderBy({ [activeSort.field]: activeSort.direction })
      : withRelations

    // The total is the same scoped read, counted in the database — so it can
    // only ever equal the number of rows this session may page through.
    const [rows, totals] = await Promise.all([
      sorted.offset(skip).limit(pageSize).all(),
      scoped.aggregate((aggregate) => ({ total: aggregate.count() })),
    ])
    items = rows
    total = totals.total
  } catch (error) {
    console.error(`Failed to fetch ${listKey}:`, error)
  }

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

  // Resolve each relationship value before crossing the server/client boundary
  // — ListConfig objects carry functions and can't be passed as props.
  const itemsWithResolvedLabels = items.map((item) => {
    const resolved: Record<string, unknown> = { ...item }
    for (const [fieldName, ref] of Object.entries(relationshipRefs)) {
      const field = listConfig.fields[fieldName]
      if (isToManyRelationshipField(field)) {
        resolved[fieldName] = readRelationshipCount(item, fieldName)
        continue
      }
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

  const serializedItems = jsonSafeClone(itemsWithResolvedLabels)

  // Collect each filterable field's serializable Filter spec metadata (fields,
  // operators, enumerated values / relationship label search) to drive the
  // Filter builder's pickers. It mirrors the same specs the server-side
  // `buildListFilterWhere` above uses, so the builder can only produce queries
  // the engine understands.
  const filterSuggestions = await collectFilterSuggestions(listConfig, listKey, config, {
    session: context.session,
    context,
  })

  // When the list opts into avatars (issue #735), the label column renders with
  // an initials bubble ahead of the emphasized Item label. The label column is
  // resolved through the shared label seam (`getLabelFieldName`), so it can
  // never drift from the field the Item label is read off.
  const avatarColumn = listConfig.ui?.avatar ? getLabelFieldName(listConfig) : undefined

  const bulkActions = await resolveVisibleBulkActions(
    listConfig.ui?.listView?.bulkActions,
    context,
    listKey,
  )

  // Fold in the structural createdAt/updatedAt exclusion (issue #1018) before
  // crossing the server/client boundary, so `ListViewClient`'s fallback (used
  // when no explicit `columns` is configured) curates off the same declared
  // `ui.listView.defaultColumn` flag as everything else — no timestamp-aware
  // logic needed on the client.
  const displayFields = withStructuralTimestampDefaults(listConfig.fields, listConfig, config.db)

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

      <ListViewClient
        items={serializedItems || []}
        fieldTypes={Object.fromEntries(
          Object.entries(displayFields).map(([key, field]) => [
            key,
            (field as { type: string }).type,
          ]),
        )}
        fields={serializeFieldConfigs(displayFields)}
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
        bulkActions={bulkActions}
      />
    </div>
  )
}
