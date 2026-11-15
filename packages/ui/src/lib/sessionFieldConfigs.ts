import { engineContextOf, parseListId } from '@opensaas/stack-core'
import type {
  AccessContext,
  AnyStackContext,
  FieldConfig,
  ListIdValue,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import { singletonRowStored } from '@opensaas/stack-core/internal'
import type { FieldVocabulary, SessionVocabulary } from '@opensaas/stack-core/internal'
import { applyClientValueTransforms } from './clientValueTransforms.js'
import { jsonSafeClone } from './jsonSafeClone.js'
import {
  FIELD_WRITE_DENIED_REASON,
  markToManyEdgeWrites,
  markUnwritableRelationships,
  projectFieldConfigs,
  type SerializableFieldConfig,
} from './serializeFieldConfig.js'

/**
 * What serialised field configs are for: `'create'` and `'update'` feed an
 * item form performing that write, `'display'` feeds anything that only shows
 * values, such as a table.
 */
export type FieldConfigPurpose = 'display' | 'create' | 'update'

export class SessionVocabularyUnavailableError extends Error {
  constructor(listKey: string) {
    super(
      `Cannot serialise field configs for "${listKey}": the context resolved no session vocabulary for it.`,
    )
    this.name = 'SessionVocabularyUnavailableError'
  }
}

/**
 * The session's vocabulary for `listKey`, with its row-dependent answers
 * resolved for the row whose id is `itemId` when one is given.
 */
export async function readSessionVocabulary(
  context: AnyStackContext,
  listKey: string,
  itemId?: string | number,
): Promise<SessionVocabulary> {
  const engine = engineContextOf(context)
  const vocabulary =
    itemId === undefined
      ? await engine._sessionVocabulary?.(listKey)
      : await engine._sessionVocabularyForItem?.(listKey, itemId)
  if (!vocabulary) throw new SessionVocabularyUnavailableError(listKey)
  return vocabulary
}

/**
 * The session's vocabulary for `listKey`, or `null` when the context resolves
 * none for it, which every caller treats as a deny.
 */
export async function vocabularyOrDeny(
  context: AnyStackContext,
  listKey: string,
): Promise<SessionVocabulary | null> {
  try {
    return await readSessionVocabulary(context, listKey)
  } catch (error) {
    if (error instanceof SessionVocabularyUnavailableError) return null
    throw error
  }
}

function writeDenied(entry: FieldVocabulary | undefined, purpose: FieldConfigPurpose): boolean {
  if (purpose === 'display') return entry?.create === 'deny' && entry.update === 'deny'
  return entry?.[purpose] === 'deny'
}

/**
 * The fields of `fieldNames` the session never sees for `purpose`: those it
 * can never read, unless the form may write them.
 */
export function withheldFieldNames(
  vocabulary: SessionVocabulary,
  fieldNames: Iterable<string>,
  purpose: FieldConfigPurpose,
): Set<string> {
  const withheld = new Set<string>()
  for (const fieldName of fieldNames) {
    const entry = vocabulary.fields.get(fieldName)
    if (entry?.read !== 'deny') continue
    if (purpose === 'display' || writeDenied(entry, purpose)) withheld.add(fieldName)
  }
  return withheld
}

/**
 * Serialise `fields` of `listKey` for one session: a field whose read answer
 * is deny is withheld, except on a form that may write it, and a field the
 * vocabulary denies writing for `purpose` is marked read-only. `itemId` is the
 * record an update form edits, which lets a to-many write its edges.
 */
export function serializeFieldsForSession(args: {
  vocabulary: SessionVocabulary
  config: OpenSaasConfig
  listKey: string
  fields: Record<string, FieldConfig>
  purpose: FieldConfigPurpose
  itemId?: string | null
}): { fields: Record<string, SerializableFieldConfig>; withheld: Set<string> } {
  const { vocabulary, config, listKey, fields, purpose } = args
  const serialized = projectFieldConfigs(fields)
  markUnwritableRelationships(serialized, listKey, fields, config)
  if (purpose === 'update') markToManyEdgeWrites(serialized, listKey, fields, config, args.itemId)

  for (const fieldName of Object.keys(fields)) {
    const field = serialized[fieldName]
    if (!field || field.readOnly || field.virtual || field.edgeWrite) continue
    if (!writeDenied(vocabulary.fields.get(fieldName), purpose)) continue
    field.readOnly = true
    field.readOnlyReason = FIELD_WRITE_DENIED_REASON
  }

  const withheld = withheldFieldNames(vocabulary, Object.keys(fields), purpose)
  for (const fieldName of Object.keys(fields)) {
    const field = serialized[fieldName]
    if (!field || vocabulary.fields.get(fieldName)?.read !== 'deny') continue
    if (withheld.has(fieldName)) {
      delete serialized[fieldName]
    } else if (purpose === 'update' && field.validation?.isRequired) {
      field.validation = { ...field.validation, isRequired: false }
    }
  }

  return { fields: serialized, withheld }
}

/**
 * One record's values as a form may send them to the browser: a value the
 * session can never read is dropped, so is a withheld field's key, and each
 * remaining field's `ui.valueForClientSerialization` is applied.
 */
export function formValuesForSession(args: {
  vocabulary: SessionVocabulary
  fields: Record<string, FieldConfig>
  values: Record<string, unknown>
  purpose: FieldConfigPurpose
}): Record<string, unknown> {
  const { vocabulary, fields, purpose } = args
  const withheld = withheldFieldNames(vocabulary, Object.keys(fields), purpose)
  const values = { ...args.values }
  const shown: Record<string, FieldConfig> = {}
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (vocabulary.fields.get(fieldName)?.read === 'deny') delete values[fieldName]
    if (!withheld.has(fieldName)) shown[fieldName] = fieldConfig
  }
  return jsonSafeClone(applyClientValueTransforms(shown, values))
}

function updatedRowId(
  purpose: FieldConfigPurpose,
  item: Readonly<Record<string, unknown>> | undefined,
): string | number | undefined {
  if (purpose !== 'update' || item === undefined) return undefined
  const id = item.id
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

function resolveList(context: AnyStackContext, listKey: string) {
  const engine = engineContextOf(context)
  const config = engine._config
  const listConfig = config && Object.hasOwn(config.lists, listKey) ? config.lists[listKey] : null
  if (!config || !listConfig) throw new SessionVocabularyUnavailableError(listKey)
  return { engine, config, fields: listConfig.fields, singleton: Boolean(listConfig.isSingleton) }
}

/**
 * The field configs of `listKey` that may be sent to the browser for the
 * session `context` carries, resolved from that session's Session vocabulary.
 *
 * A field the session can never read is withheld. A field it can never write
 * for `purpose` is marked `readOnly`. On a `'create'` or `'update'` form a
 * field the session may write but never read stays, empty.
 *
 * A rule that depends on the row keeps the field editable, and the write
 * itself still enforces it — unless `item` is given on an `'update'`: then each
 * such write rule is answered for the row with `item`'s id, against that row
 * as stored, as the update decides it, and a field it denies there is marked
 * `readOnly` like any other. A `read` rule that depends on the row keeps the
 * field; the read that produced the form's values applied it.
 *
 * Pass `'create'` to `ItemCreateForm`'s `fields`, `'update'` (with the record
 * being edited) to `ItemEditForm`'s, and `'display'` (the default) to
 * `ListTable`'s.
 *
 * @throws {SessionVocabularyUnavailableError} when `listKey` is not a list of
 *   the context's config.
 */
export async function serializeFieldConfigs(
  context: AnyStackContext,
  listKey: string,
  purpose: FieldConfigPurpose = 'display',
  item?: Readonly<Record<string, unknown>>,
): Promise<Record<string, SerializableFieldConfig>> {
  const { engine, config, fields } = resolveList(context, listKey)
  return serializeFieldsForSession({
    vocabulary: await readSessionVocabulary(engine, listKey, updatedRowId(purpose, item)),
    config,
    listKey,
    fields,
    purpose,
  }).fields
}

/**
 * One record's id as the string the client form carries. An `int autoincrement`
 * list's id arrives as a number (ADR-0048); the server action's id boundary
 * parses each string back to its own list's key type.
 */
export function readId(record: unknown): string | null {
  if (typeof record !== 'object' || record === null || !('id' in record)) return null
  const id: unknown = record.id
  if (typeof id === 'string') return id
  return typeof id === 'number' ? String(id) : null
}

function isToOne(field: FieldConfig): boolean {
  return field.type === 'relationship' && !('many' in field && field.many === true)
}

interface FormProjection {
  scalars: string[]
  relationships: string[]
}

function formProjection(
  fields: Record<string, FieldConfig>,
  vocabulary: SessionVocabulary,
): FormProjection {
  const readable = Object.entries(fields).filter(
    ([fieldName]) => vocabulary.fields.get(fieldName)?.read !== 'deny',
  )
  return {
    scalars: readable
      .filter(([, field]) => field.type !== 'relationship')
      .map(([fieldName]) => fieldName),
    relationships: readable.filter(([, field]) => isToOne(field)).map(([fieldName]) => fieldName),
  }
}

function projectFormRow(
  row: Readonly<Record<string, unknown>>,
  { scalars, relationships }: FormProjection,
): Record<string, unknown> {
  const values: Record<string, unknown> = { id: row.id }
  for (const fieldName of scalars) {
    if (Object.hasOwn(row, fieldName)) values[fieldName] = row[fieldName]
  }
  for (const fieldName of relationships) {
    if (Object.hasOwn(row, fieldName)) values[fieldName] = readId(row[fieldName])
  }
  return values
}

async function readFormRow(
  engine: AccessContext,
  listKey: string,
  id: ListIdValue,
  projection: FormProjection,
): Promise<Record<string, unknown> | null> {
  const read = projection.relationships.reduce(
    (query, fieldName) => query.include(fieldName, (related) => related.select('id')),
    engine.db[listKey].where({ id: { equals: id } }).select('id', ...projection.scalars),
  )
  const row = await read.first()
  return row === null ? null : projectFormRow(row, projection)
}

async function readSingletonFormRow(
  engine: AccessContext,
  listKey: string,
  id: ListIdValue,
  projection: FormProjection,
): Promise<Record<string, unknown> | null> {
  const delegate = engine.db[listKey]
  if (!delegate.get || !(await singletonRowStored(engine, listKey))) return null
  const include = Object.fromEntries(projection.relationships.map((name) => [name, true]))
  const row = await delegate.get({ include })
  if (row === null || row.id !== id) return null
  return projectFormRow(row, projection)
}

/**
 * One record of `listKey`, read by `id` through the session's own secured
 * surface and prepared as `ItemEditForm`'s `initialData`. The read applies
 * the Access Filter and Field Visibility, including a `read` rule that depends
 * on the row; each field's `ui.valueForClientSerialization` is then applied,
 * every field `serializeFieldConfigs(context, listKey, purpose)` withholds is
 * left out, and a to-one relationship is reduced to its related id.
 *
 * `id` is parsed against the list's `db.idField`, as an admin URL segment is.
 * Resolves `null` when the session may not read the row, when no row has that
 * id, and when the list's key type cannot hold `id`.
 *
 * @throws {SessionVocabularyUnavailableError} when `listKey` is not a list of
 *   the context's config.
 *
 * @example
 * ```typescript
 * const initialData = await serializeItemForForm(context, 'Post', params.id)
 * if (initialData === null) notFound()
 * ```
 */
export async function serializeItemForForm(
  context: AnyStackContext,
  listKey: string,
  id: ListIdValue,
  purpose: FieldConfigPurpose = 'update',
): Promise<Record<string, unknown> | null> {
  const { engine, config, fields, singleton } = resolveList(context, listKey)
  const parsed = parseListId(config, listKey, id)
  if (!parsed.ok) return null
  const vocabulary = await readSessionVocabulary(engine, listKey)
  const projection = formProjection(fields, vocabulary)
  const read = singleton ? readSingletonFormRow : readFormRow
  const row = await read(engine, listKey, parsed.value, projection)
  if (row === null) return null
  return formValuesForSession({
    vocabulary:
      purpose === 'update'
        ? await readSessionVocabulary(engine, listKey, parsed.value)
        : vocabulary,
    fields,
    values: row,
    purpose,
  })
}
