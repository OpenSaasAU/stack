import Link from 'next/link.js'
import { unstable_rethrow } from 'next/navigation.js'
import { AlertTriangle, Plus } from 'lucide-react'
import { ListViewClient } from './ListViewClient.js'
import type { SerializedBulkAction } from './BulkActions.js'
import type { SerializedRowAction } from './RowActions.js'
import { formatListName } from '../lib/utils.js'
import { serializeFieldConfigs } from '../lib/serializeFieldConfig.js'
import { computeDefaultColumns, withStructuralTimestampDefaults } from '../lib/defaultColumns.js'
import { resolveListUi } from '../lib/resolveListUi.js'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../lib/pageSize.js'
import { jsonSafeClone } from '../lib/jsonSafeClone.js'
import { applyClientValueTransforms } from '../lib/clientValueTransforms.js'
import { EmptyState } from './EmptyState.js'
import { PageHeader } from './PageHeader.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import { isRelationshipField, shouldHaveForeignKey } from '@opensaas/stack-core/fields'
import {
  type AccessContext,
  type AccessControl,
  type AnyStackContext,
  type BulkAction,
  type FieldConfig,
  type RowAction,
  engineContextOf,
  buildFilterWhere,
  collectFilterSpecs,
  filterSuggestionsOf,
  filterValueRecordId,
  getItemLabel,
  getLabelFieldName,
  getUrlKey,
  isFieldFilterableById,
  isRelationshipLabelReadable,
  isToManyRelationshipField,
  OpenSaasConfig,
  parseListId,
} from '@opensaas/stack-core'
import type { FilterSpec, FilterToken, SecuredQuery } from '@opensaas/stack-core'
import type { CountFilterLink, FilterRemoval } from './ListViewClient.js'
import {
  chipsOf,
  entriesQuery,
  entriesTerms,
  hydrateEntries,
  isFieldCondition,
  removableTerms,
  type FilterEntry,
  type FilterFields,
  type RecordOf,
  type ResolvedFilterRecord,
} from '../lib/filterBuilderOptions.js'
import {
  collectUnreadableFields,
  filterByHasAccess,
  isRowActionAvailable,
  RELATIONSHIP_OPTIONS_MAX_TAKE,
  resolvePresetViews,
} from '@opensaas/stack-core/internal'

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

async function availableRowActionKeys(
  actions: RowAction[],
  listKey: string,
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
      .filter((action) => isRowActionAvailable(action, listKey, item, session))
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

function relatedListKeyOf(field: unknown): string | undefined {
  if (typeof field !== 'object' || field === null) return undefined
  if (!('type' in field) || field.type !== 'relationship') return undefined
  if (!('ref' in field) || typeof field.ref !== 'string') return undefined
  return field.ref.split('.')[0]
}

async function resolveRecordLabels(
  tokens: readonly FilterToken[],
  fields: FilterFields,
  listConfig: OpenSaasConfig['lists'][string],
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<Record<string, ResolvedFilterRecord[]>> {
  const idsByField = new Map<string, Set<string>>()
  for (const token of tokens) {
    const field = token.field
    if (field === null || token.operator !== 'eq' || !fields.get(field)?.matchesById) continue
    for (const value of token.values) {
      const id = filterValueRecordId(value)
      if (id !== null) idsByField.set(field, (idsByField.get(field) ?? new Set()).add(id))
    }
  }

  const entries = await Promise.all(
    [...idsByField].map(async ([field, ids]): Promise<[string, ResolvedFilterRecord[]]> => {
      const relatedListKey = relatedListKeyOf(listConfig.fields[field])
      const relatedListConfig =
        relatedListKey && Object.hasOwn(config.lists, relatedListKey)
          ? config.lists[relatedListKey]
          : undefined
      if (!relatedListKey || !relatedListConfig) return [field, []]
      const parsed = [...ids].flatMap((id) => {
        const result = parseListId(config, relatedListKey, id)
        return result.ok ? [{ id, value: result.value }] : []
      })
      const looked = parsed.slice(0, RELATIONSHIP_OPTIONS_MAX_TAKE)
      let rows: Array<Record<string, unknown>> = []
      if (looked.length > 0) {
        try {
          const labelReadable = await isRelationshipLabelReadable(context, config, relatedListKey)
          const labelField = getLabelFieldName(relatedListConfig)
          const read = context.db[relatedListKey].where({
            id: { in: looked.map(({ value }) => value) },
          })
          rows = await (labelReadable ? read.select('id', labelField) : read.select('id')).all()
        } catch (error) {
          unstable_rethrow(error)
          console.error(`Filter labels for "${field}" could not be read:`, error)
        }
      }
      return [
        field,
        parsed.map(({ id, value }) => {
          const row = rows.find((candidate) => String(candidate.id) === String(value))
          return { id, label: row ? getItemLabel(relatedListConfig, row) : null }
        }),
      ]
    }),
  )
  return Object.fromEntries(entries.filter(([, records]) => records.length > 0))
}

const FILTER_REMOVAL_TERMS = 5

function filteredFields(tokens: readonly FilterToken[], fields: FilterFields): string[] {
  return [
    ...new Set(
      tokens
        .filter((token) => isFieldCondition(token, fields))
        .flatMap((token) => (token.field === null ? [] : [token.field])),
    ),
  ]
}

async function resolveFilterRemoval(
  entries: FilterEntry[],
  fields: FilterFields,
  specs: Record<string, FilterSpec>,
  recordOf: RecordOf,
  list: SecuredQuery,
  listKey: string,
): Promise<FilterRemoval | null> {
  const terms = removableTerms(entries, chipsOf(entries, fields, recordOf)).slice(
    0,
    FILTER_REMOVAL_TERMS,
  )
  if (terms.length === 0) return null
  try {
    const removals = await Promise.all(
      terms.map(async ({ sentence, rest }) => {
        const where = buildFilterWhere({ terms: entriesTerms(rest) }, specs)
        const scoped = where ? list.where(where) : list
        const { rows } = await scoped.aggregate((aggregate) => ({ rows: aggregate.count() }))
        return { sentence, rest, rows }
      }),
    )
    const best = removals.reduce<(typeof removals)[number] | null>(
      (current, removal) => (removal.rows > (current?.rows ?? 0) ? removal : current),
      null,
    )
    if (!best) return null
    return {
      search: entriesQuery(entries),
      query: entriesQuery(best.rest),
      sentence: best.sentence,
      rows: best.rows,
    }
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Filter removal counts for ${listKey} could not be read:`, error)
    return null
  }
}

async function isCountLinkable(
  otherListKey: string,
  otherField: string,
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<boolean> {
  if (!Object.hasOwn(config.lists, otherListKey)) return false
  const otherListConfig = config.lists[otherListKey]
  if (otherListConfig.isSingleton) return false
  try {
    return await isFieldFilterableById(otherListConfig, otherListKey, otherField, config, {
      session: context.session,
      context,
    })
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Count link to "${otherListKey}.${otherField}" could not be resolved:`, error)
    return false
  }
}

async function resolveCountLinks(
  countedRelations: ReadonlySet<string>,
  listConfig: OpenSaasConfig['lists'][string],
  config: OpenSaasConfig,
  context: AccessContext,
): Promise<Record<string, CountFilterLink>> {
  const checks = new Map<string, Promise<boolean>>()
  const entries = await Promise.all(
    [...countedRelations].map(async (fieldName): Promise<[string, CountFilterLink] | null> => {
      const field = listConfig.fields[fieldName]
      if (!('ref' in field) || typeof field.ref !== 'string') return null
      const [otherListKey, otherField] = field.ref.split('.')
      if (!otherField) return null
      const key = JSON.stringify([otherListKey, otherField])
      const check = checks.get(key) ?? isCountLinkable(otherListKey, otherField, config, context)
      checks.set(key, check)
      return (await check)
        ? [fieldName, { urlKey: getUrlKey(otherListKey), field: otherField }]
        : null
    }),
  )
  return Object.fromEntries(entries.filter((entry) => entry !== null))
}

function readableFieldsOf<T>(
  fields: Record<string, T>,
  unreadable: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !unreadable.has(name)))
}

function withheldKeysOf(
  unreadable: ReadonlySet<string>,
  listConfig: OpenSaasConfig['lists'][string],
  listKey: string,
  config: OpenSaasConfig,
): Set<string> {
  const keys = new Set(unreadable)
  for (const name of unreadable) {
    const field: FieldConfig | undefined = listConfig.fields[name]
    if (!isRelationshipField(field)) continue
    if (!Object.hasOwn(config.lists, field.ref.split('.')[0])) continue
    if (shouldHaveForeignKey(listKey, name, field, config)) keys.add(`${name}Id`)
  }
  return keys
}

function withoutKeys(
  item: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !keys.has(key)))
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
  /**
   * The columns the admin chose, from the `?columns=` URL param. Names this
   * list does not display are ignored, and an empty selection falls back to
   * `columns`. Resolved here so a to-many count is read for every column shown.
   */
  visibleColumns?: string[]
  /**
   * Whether this page reads `?columns=` and `?pageSize=` back into
   * `visibleColumns` and `pageSize`. Offers the Columns menu and the
   * rows-per-page control, which write those params. `AdminUI` sets it.
   */
  urlControls?: boolean
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
   * The Preset view key from the `?preset=` URL param. A key this session may
   * open replaces `search` with the preset's resolved query and sorts by its
   * `sort` unless `sort` is given; any other key is ignored.
   */
  preset?: string
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
  visibleColumns,
  urlControls = false,
  page = 1,
  pageSize: requestedPageSize = DEFAULT_PAGE_SIZE,
  search,
  initialSort,
  sort,
  preset,
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

  const unreadableFields = await collectUnreadableFields(listConfig, {
    session: context.session,
    context,
  })
  const readable = (name: string) => !unreadableFields.has(name)
  const readableListFields = readableFieldsOf(listConfig.fields, unreadableFields)
  const displayFields = readableFieldsOf(
    withStructuralTimestampDefaults(listConfig.fields, listConfig, config.db),
    unreadableFields,
  )
  const withheldKeys = withheldKeysOf(unreadableFields, listConfig, listKey, config)
  const availableColumns = [
    ...new Set([
      ...(columns ?? []).filter((name) => !Object.hasOwn(displayFields, name)),
      ...Object.keys(displayFields),
    ]),
  ].filter(readable)
  const chosenColumns = [...new Set(visibleColumns ?? [])].filter((name) =>
    availableColumns.includes(name),
  )
  const readableDefaults = (columns ?? computeDefaultColumns(displayFields)).filter(readable)
  const defaultColumns =
    readableDefaults.length > 0
      ? readableDefaults
      : Object.keys(displayFields).filter(readable).slice(0, 1)
  const baseColumns = chosenColumns.length > 0 ? chosenColumns : defaultColumns

  const pageSize = Math.min(
    Math.max(1, Math.floor(requestedPageSize) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  )
  const presetViews = resolvePresetViews(listConfig, listKey, context, preset)
  const activePreset = await presetViews.active
  const activeSearch = activePreset ? activePreset.search : search
  const sortCandidates = [sort, activePreset?.sort, initialSort]

  const filterSpecs = await collectFilterSpecs(listConfig, listKey, config, {
    session: context.session,
    context,
  })
  const filterSuggestions = filterSuggestionsOf(filterSpecs)
  const filterFields: FilterFields = new Map(
    filterSuggestions.map((suggestion) => [suggestion.field, suggestion]),
  )
  const searchEntries = activeSearch ? hydrateEntries(activeSearch) : []
  const searchTokens = searchEntries.map((entry) => entry.token)
  const autoColumns = filteredFields(searchTokens, filterFields).filter(
    (name) => Object.hasOwn(displayFields, name) && !baseColumns.includes(name),
  )
  const displayedColumns = new Set([...baseColumns, ...autoColumns])
  // Naming a relation in the read suppresses the engine's declared-dependency
  // widening for it (`resolveIncludes`), and a reduced relation is masked to
  // `[]` for the rules and computed fields that read it — so a to-many is
  // counted only where a column displays that count.
  const countedRelations = new Set(
    Object.entries(listConfig.fields)
      .filter(([name, field]) => isToManyRelationshipField(field) && displayedColumns.has(name))
      .map(([name]) => name),
  )

  const currentPage = Number.isSafeInteger(page) && page >= 1 ? page : 1
  const skip = (currentPage - 1) * pageSize
  let items: Array<Record<string, unknown>> = []
  let total = 0
  let countLinks: Record<string, CountFilterLink> = {}
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
        ...sortCandidates.flatMap((candidate) => (candidate ? [candidate.field] : [])),
      ])) ?? new Set<string>()
    activeSort = sortCandidates.find((candidate) => candidate && orderable.has(candidate.field))
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
      searchEntries.length > 0
        ? buildFilterWhere({ terms: entriesTerms(searchEntries) }, filterSpecs)
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
    const [rows, totals, links] = await Promise.all([
      sorted.offset(skip).limit(pageSize).all(),
      scoped.aggregate((aggregate) => ({ total: aggregate.count() })),
      resolveCountLinks(countedRelations, listConfig, config, context),
    ])
    items = rows
    total = totals.total
    countLinks = links
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
  Object.entries(readableListFields).forEach(([fieldName, field]) => {
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
    const resolved = withoutKeys(item, withheldKeys)
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
    itemsWithResolvedLabels.map((item) => applyClientValueTransforms(readableListFields, item)),
  )

  const recordLabels = await resolveRecordLabels(
    searchTokens,
    filterFields,
    listConfig,
    config,
    context,
  )
  const filterRemoval =
    total === 0 && searchTokens.length > 0 && filterSuggestions.length > 0
      ? await resolveFilterRemoval(
          searchEntries,
          filterFields,
          filterSpecs,
          (field, id) => recordLabels[field]?.find((record) => record.id === id),
          context.db[key],
          listKey,
        )
      : null

  // When the list opts into avatars (issue #735), the label column renders with
  // an initials bubble ahead of the emphasized Item label. The label column is
  // resolved through the shared label seam (`getLabelFieldName`), so it can
  // never drift from the field the Item label is read off.
  const labelField = getLabelFieldName(listConfig)
  const labelColumn = readable(labelField) ? labelField : undefined
  const avatarColumn = listConfig.ui?.avatar ? labelColumn : undefined

  const pageIds = items.flatMap((item) =>
    typeof item.id === 'string' || typeof item.id === 'number' ? [item.id] : [],
  )
  const resolveRowActions = async (): Promise<{
    visibleRowActions: RowAction[]
    rowActionKeys: Record<string, string[]>
  }> => {
    if (!serverAction) return { visibleRowActions: [], rowActionKeys: {} }
    const visible = await filterByHasAccess(
      listConfig.ui?.listView?.rowActions,
      context,
      listKey,
      'Row action',
    )
    const keys = await availableRowActionKeys(
      visible,
      listKey,
      context.db[key],
      pageIds,
      context.session,
    )
    return { visibleRowActions: visible, rowActionKeys: keys }
  }
  const [
    visibleBulkActions,
    { visibleRowActions, rowActionKeys },
    { hideCreate, hideDelete },
    presetTabs,
  ] = await Promise.all([
    filterByHasAccess(listConfig.ui?.listView?.bulkActions, context, listKey, 'Bulk action'),
    resolveRowActions(),
    resolveListUi(listConfig, context),
    presetViews.tabs,
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
          Object.entries(displayFields).map(([key, field]) => [key, field.type]),
        )}
        fields={serializeFieldConfigs(displayFields)}
        relationshipRefs={relationshipRefs}
        columns={baseColumns}
        availableColumns={urlControls ? availableColumns : undefined}
        pageSizeControl={urlControls}
        defaultColumns={defaultColumns}
        columnsChosen={chosenColumns.length > 0}
        sortableFields={sortableFields}
        initialSort={activeSort}
        listKey={listKey}
        urlKey={urlKey}
        basePath={basePath}
        page={currentPage}
        pageSize={pageSize}
        total={total || 0}
        search={activeSearch}
        presets={presetTabs}
        activePreset={activePreset?.key}
        filterSuggestions={filterSuggestions}
        recordLabels={recordLabels}
        countLinks={countLinks}
        serverAction={serverAction}
        canDelete={!hideDelete && canDeleteList(listConfig.access?.operation?.delete)}
        canCreate={!hideCreate}
        avatarColumn={avatarColumn}
        labelColumn={labelColumn}
        bulkActions={bulkActions}
        rowActions={visibleRowActions.map(serializeRowAction)}
        rowActionKeys={rowActionKeys}
        autoColumns={autoColumns}
        filterRemoval={filterRemoval}
      />
    </div>
  )
}
