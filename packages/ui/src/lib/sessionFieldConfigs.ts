import { engineContextOf } from '@opensaas/stack-core'
import type { AnyStackContext, FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import type { SessionVocabulary } from '@opensaas/stack-core/internal'
import {
  FIELD_HOOK_ONLY_REASON,
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

function writeDenied(
  vocabulary: SessionVocabulary,
  fieldName: string,
  purpose: FieldConfigPurpose,
): boolean {
  const entry = vocabulary.fields.get(fieldName)
  if (!entry) return true
  if (purpose === 'display') return entry.create === 'deny' && entry.update === 'deny'
  return entry[purpose] === 'deny'
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
}): Record<string, SerializableFieldConfig> {
  const { vocabulary, config, listKey, fields, purpose } = args
  const serialized = projectFieldConfigs(fields)
  markUnwritableRelationships(serialized, listKey, fields, config)
  if (purpose === 'update') markToManyEdgeWrites(serialized, listKey, fields, config, args.itemId)

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    const field = serialized[fieldName]
    if (!field || field.readOnly || field.virtual || field.edgeWrite) continue
    if (!writeDenied(vocabulary, fieldName, purpose)) continue
    field.readOnly = true
    field.readOnlyReason =
      fieldConfig.access?.write === 'hooks' ? FIELD_HOOK_ONLY_REASON : FIELD_WRITE_DENIED_REASON
  }

  for (const fieldName of Object.keys(fields)) {
    const field = serialized[fieldName]
    if (!field || vocabulary.fields.get(fieldName)?.read !== 'deny') continue
    if (purpose === 'display' || field.readOnly) {
      delete serialized[fieldName]
    } else if (purpose === 'update' && field.validation?.isRequired) {
      field.validation = { ...field.validation, isRequired: false }
    }
  }

  for (const fieldName of Object.keys(serialized)) {
    if (!vocabulary.fields.has(fieldName)) delete serialized[fieldName]
  }

  return serialized
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
  const engine = engineContextOf(context)
  const config = engine._config
  const listConfig = config && Object.hasOwn(config.lists, listKey) ? config.lists[listKey] : null
  if (!config || !listConfig) throw new SessionVocabularyUnavailableError(listKey)
  return serializeFieldsForSession({
    vocabulary: await readSessionVocabulary(engine, listKey),
    config,
    listKey,
    fields: listConfig.fields,
    purpose,
  })
}
