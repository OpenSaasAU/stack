import Link from 'next/link.js'
import { unstable_rethrow } from 'next/navigation.js'
import { AlertTriangle, Plus } from 'lucide-react'
import { ListViewClient } from './ListViewClient.js'
import type { SerializedBulkAction } from './BulkActions.js'
import type { SerializedRowAction } from './RowActions.js'
import { formatListName } from '../lib/utils.js'
import { serializeFieldConfigs } from '../lib/serializeFieldConfig.js'
import { isDefaultColumnField, withStructuralTimestampDefaults } from '../lib/defaultColumns.js'
import { resolveListUi } from '../lib/resolveListUi.js'
import { jsonSafeClone } from '../lib/jsonSafeClone.js'
import { applyClientValueTransforms } from '../lib/clientValueTransforms.js'
import { EmptyState } from './EmptyState.js'
import { PageHeader } from './PageHeader.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AccessContext,
  type AccessControl,
  type AnyStackContext,
  type BulkAction,
  type RowAction,
  engineContextOf,
  buildListFilterWhere,
  collectFilterSuggestions,
  getItemLabel,
  getLabelFieldName,
  getUrlKey,
  isToManyRelationshipField,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import type { SecuredQuery } from '@opensaas/stack-core'

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

type ActionAccessGate = (args: {
  session: AccessContext['session']
  context: AccessContext
  listKey: string
}) => boolean | Promise<boolean>

/**
 * The declared actions (Bulk or Row) whose `hasAccess` gate admits this
 * session, resolved once per request. A gate that throws hides its action
 * rather than failing the list page. The gate is re-checked on dispatch, so
 * hiding an action is a UX affordance, not the security boundary.
 */
async function resolveVisibleActions<TAction extends { key: string; hasAccess?: ActionAccessGate }>(
  actions: TAction[] | undefined,
  context: AccessContext,
  listKey: string,
): Promise<TAction[]> {
  if (!actions || actions.length === 0) return []
  const allowed = await Promise.all(
    actions.map(async (action) => {
      if (!action.hasAccess) return true
      try {
        return await action.hasAccess({ session: context.session, context, listKey })
      } catch (error) {
        console.error(`Action "${action.key}" hasAccess threw:`, error)
        return false
      }
    }),
  )
  return actions.filter((_, index) => allowed[index])
}

function serializeBulkAction(action: BulkAction): SerializedBulkAction {
  return {
    key: action.key,
    label: action.label,
    ...(action.variant ? { variant: action.variant } : {}),
    ...(action.destructive ? { destructive: action.destructive } : {}),
  }
}

function serializeRowAction(action: RowAction): SerializedRowAction {
  return {
    key: action.key,
    label: action.label,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.destructive ? { destructive: action.destructive } : {}),
  }
}

function isRowActionAvailable(
  action: RowAction,
  item: Record<string, unknown>,
  session: AccessContext['session'],
): boolean {
  if (!action.isAvailable) return true
  try {
    return action.isAvailable({ item, session })
  } catch (error) {
    console.error(`Row action "${action.key}" isAvailable threw:`, error)
    return false
  }
}

/**
 * The keys of the Row actions each row offers, keyed by row id. `isAvailable`
 * is evaluated over a read of the page's rows in the shape dispatch re-reads
 * one row in, with no includes, so a computed field sees the same
 * dependencies here as it does when the action runs.
 */
async function availableRowActionKeys(
  actions: RowAction[],
  read: SecuredQuery,
  ids: Array<string | number>,
  session: AccessContext['session'],
): Promise<Record<string, string[]>> {
  if (actions.length === 0 || ids.length === 0) return {}
  let rows: Array<Record<string, unknown>> = ids.map((id) => ({ id }))
  if (actions.some((action) => action.isAvailable)) {
    try {
      rows = await read.where({ id: { in: ids } }).all()
    } catch (error) {
      unstable_rethrow(error)
      console.error('Row action availability could not be read:', error)
      const unconditional = actions
        .filter((action) => !action.isAvailable)
        .map((action) => action.key)
      if (unconditional.length === 0) return {}
      return Object.fromEntries(ids.map((id) => [String(id), unconditional]))
    }
  }
  const keysById: Record<string, string[]> = {}
  for (const item of rows) {
    const keys = actions
      .filter((action) => isRowActionAvailable(action, item, session))
      .map((action) => action.key)
    if (keys.length > 0) keysById[String(item.id)] = keys
  }
  return keysById
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
 * Read a to-many relationship's access-scoped count off a fetched row. The
 * native count reducer puts the number at the relation's own key, in place of
 * its rows. A relation the session may not read is absent, and an unknown count
 * is not a zero, so it stays `null` and the cell renders no number.
 */
function readRelationshipCount(item: Record<string, unknown>, fieldName: string): number | null {
  const value = item[fieldName]
  return typeof value === 'number' ? value : null
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
  context: AnyStackContext
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
  context: appContext,
  config,
  listKey,
  basePath = '/admin',
  columns,
  page = 1,
  pageSize: requestedPageSize = 50,
  search,
  initialSort,
  sort,
  serverAction,
}: ListViewProps) {
  const context = engineContextOf(appContext)
  const key = listKey
  const urlKey = getUrlKey(listKey)
  const listConfig = Object.hasOwn(config.lists, listKey) ? config.lists[listKey] : undefined

  if (!listConfig) {
    return (
      <div className="p-4 md:p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h1 className="text-lg font-semibold mb-2">List not found</h1>
          <p>The list &quot;{listKey}&quot; does not exist in your configuration.</p>
        </div>
      </div>
    )
  }

  // Fold in the structural createdAt/updatedAt exclusion (issue #1018) before
  // crossing the server/client boundary, so `ListViewClient`'s fallback (used
  // when no explicit `columns` is configured) curates off the same declared
  // `ui.listView.defaultColumn` flag as everything else — no timestamp-aware
  // logic needed on the client.
  const displayFields = withStructuralTimestampDefaults(listConfig.fields, listConfig, config.db)

  // The columns `ListViewClient` will actually render, resolved the same way it
  // resolves them. Naming a relation in the read suppresses the engine's
  // declared-dependency widening for it (`resolveIncludes`), and a reduced
  // relation is masked to `[]` for the rules and computed fields that read it —
  // so a to-many is counted only where a column displays that count.
  const displayedColumns = new Set(
    columns ??
      Object.keys(displayFields).filter((name) => isDefaultColumnField(displayFields[name])),
  )
  const countedRelations = new Set(
    Object.entries(listConfig.fields)
      .filter(([name, field]) => isToManyRelationshipField(field) && displayedColumns.has(name))
      .map(([name]) => name),
  )

  const pageSize = Math.min(Math.max(1, Math.floor(requestedPageSize) || 50), 200)
  const currentPage = Number.isSafeInteger(page) && page >= 1 ? page : 1
  const skip = (currentPage - 1) * pageSize
  let items: Array<Record<string, unknown>> = []
  let total = 0
  let activeSort: ListViewSort | undefined
  let sortableFields: Record<string, boolean> = {}

  try {
    const dbContext = context.db
    if (!dbContext || !dbContext[key]) {
      throw new Error(`Context for ${listKey} not found`)
    }

    const orderable =
      (await context._orderableKeys?.(listKey, [
        ...displayedColumns,
        ...[sort, initialSort].flatMap((candidate) => (candidate ? [candidate.field] : [])),
      ])) ?? new Set<string>()
    activeSort = [sort, initialSort].find(
      (candidate) => candidate && orderable.has(candidate.field),
    )
    sortableFields = Object.fromEntries(
      [...displayedColumns].map((column) => [column, orderable.has(column)]),
    )

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
    // to-many displayed as a count reduces to the count of the related rows
    // this session may see, through the surface's own reducer — never the
    // related rows themselves, which would be an unbounded per-row fetch
    // (issue #732).
    const scoped: SecuredQuery = parsedWhere ? dbContext[key].where(parsedWhere) : dbContext[key]
    const withRelations = Object.entries(listConfig.fields).reduce((read, [fieldName, field]) => {
      if (field.type !== 'relationship') return read
      if (!isToManyRelationshipField(field)) return read.include(fieldName)
      return countedRelations.has(fieldName)
        ? read.include(fieldName, (rows) => rows.count())
        : read
    }, scoped)

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
    unstable_rethrow(error)
    console.error(`Failed to fetch ${listKey}:`, error)
    return (
      <div className="p-4 md:p-8">
        <PageHeader title={formatListName(listKey)} />
        <div role="alert" data-slot="list-view-error">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="This list could not be loaded"
            description="Something went wrong while reading it, so its records are not shown here. Nothing has been changed."
            actions={
              <Button asChild size="sm" variant="outline">
                <Link href={`${basePath}/${urlKey}`}>Reload list</Link>
              </Button>
            }
          />
        </div>
      </div>
    )
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
        if (countedRelations.has(fieldName))
          resolved[fieldName] = readRelationshipCount(item, fieldName)
        else delete resolved[fieldName]
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

  const serializedItems = jsonSafeClone(
    itemsWithResolvedLabels.map((item) => applyClientValueTransforms(listConfig.fields, item)),
  )

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

  const pageIds = items.flatMap((item) =>
    typeof item.id === 'string' || typeof item.id === 'number' ? [item.id] : [],
  )
  const resolveRowActions = async () => {
    const visible = await resolveVisibleActions(
      listConfig.ui?.listView?.rowActions,
      context,
      listKey,
    )
    const keys = await availableRowActionKeys(visible, context.db[key], pageIds, context.session)
    return { visibleRowActions: visible, rowActionKeys: keys }
  }
  const [visibleBulkActions, { visibleRowActions, rowActionKeys }, { hideCreate, hideDelete }] =
    await Promise.all([
      resolveVisibleActions(listConfig.ui?.listView?.bulkActions, context, listKey),
      resolveRowActions(),
      resolveListUi(listConfig, context),
    ])
  const bulkActions = visibleBulkActions.map(serializeBulkAction)

  return (
    <div className="p-4 md:p-8">
      <PageHeader
        title={formatListName(listKey)}
        description={`${total} ${total === 1 ? 'item' : 'items'}`}
        actions={
          hideCreate ? undefined : (
            <Button asChild>
              <Link href={`${basePath}/${urlKey}/create`}>
                <Plus aria-hidden="true" />
                Create {formatListName(listKey)}
              </Link>
            </Button>
          )
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
        sortableFields={sortableFields}
        initialSort={activeSort}
        listKey={listKey}
        urlKey={urlKey}
        basePath={basePath}
        page={currentPage}
        pageSize={pageSize}
        total={total || 0}
        search={search}
        filterSuggestions={filterSuggestions}
        serverAction={serverAction}
        canDelete={!hideDelete && canDeleteList(listConfig.access?.operation?.delete)}
        canCreate={!hideCreate}
        avatarColumn={avatarColumn}
        labelColumn={getLabelFieldName(listConfig)}
        bulkActions={bulkActions}
        rowActions={visibleRowActions.map(serializeRowAction)}
        rowActionKeys={rowActionKeys}
      />
    </div>
  )
}
