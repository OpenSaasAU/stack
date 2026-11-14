import { engineContextOf } from '@opensaas/stack-core'
import type { AnyStackContext, FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
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

export async function readSessionVocabulary(
  context: AnyStackContext,
  listKey: string,
): Promise<SessionVocabulary> {
  const vocabulary = await engineContextOf(context)._sessionVocabulary?.(listKey)
  if (!vocabulary) throw new SessionVocabularyUnavailableError(listKey)
  return vocabulary
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

function resolveList(context: AnyStackContext, listKey: string) {
  const engine = engineContextOf(context)
  const config = engine._config
  const listConfig = config && Object.hasOwn(config.lists, listKey) ? config.lists[listKey] : null
  if (!config || !listConfig) throw new SessionVocabularyUnavailableError(listKey)
  return { engine, config, fields: listConfig.fields }
}

/**
 * The field configs of `listKey` that may be sent to the browser for the
 * session `context` carries, resolved from that session's Session vocabulary.
 *
 * A field the session can never read is withheld. A field it can never write
 * for `purpose` is marked `readOnly`; a rule that depends on the row keeps the
 * field editable, and the write itself still enforces it. On a `'create'` or
 * `'update'` form a field the session may write but never read stays, empty.
 *
 * Pass `'create'` to `ItemCreateForm`'s `fields`, `'update'` to
 * `ItemEditForm`'s, and `'display'` (the default) to `ListTable`'s.
 *
 * @throws {SessionVocabularyUnavailableError} when `listKey` is not a list of
 *   the context's config.
 */
export async function serializeFieldConfigs(
  context: AnyStackContext,
  listKey: string,
  purpose: FieldConfigPurpose = 'display',
): Promise<Record<string, SerializableFieldConfig>> {
  const { engine, config, fields } = resolveList(context, listKey)
  return serializeFieldsForSession({
    vocabulary: await readSessionVocabulary(engine, listKey),
    config,
    listKey,
    fields,
    purpose,
  }).fields
}

/**
 * One record of `listKey` prepared as `ItemEditForm`'s `initialData` for the
 * session `context` carries: each field's `ui.valueForClientSerialization` is
 * applied, and every field `serializeFieldConfigs(context, listKey, purpose)`
 * withholds is left out, as is any value the session can never read.
 *
 * @throws {SessionVocabularyUnavailableError} when `listKey` is not a list of
 *   the context's config.
 */
export async function serializeItemForForm(
  context: AnyStackContext,
  listKey: string,
  item: Record<string, unknown>,
  purpose: FieldConfigPurpose = 'update',
): Promise<Record<string, unknown>> {
  const { engine, fields } = resolveList(context, listKey)
  return formValuesForSession({
    vocabulary: await readSessionVocabulary(engine, listKey),
    fields,
    values: item,
    purpose,
  })
}
