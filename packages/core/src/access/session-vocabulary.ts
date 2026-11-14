import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext, AccessControl } from './types.js'
import { checkAccess } from './engine.js'
import {
  classifyRowIndependentCreateAccess,
  classifyRowIndependentRead,
  classifyRowIndependentWrite,
} from './field-access.js'
import { isRelationshipField } from '../fields/index.js'
import { hasColumnOrder } from '../secured/read.js'

/**
 * What a session may be told about one access question ahead of any request.
 * `'row-dependent'` is a rule that reads the row or the payload, so only a real
 * request can answer it; each consumer decides what that means for it
 * (ADR-0044, ADR-0053, ADR-0084).
 */
export type AccessAnswer = 'allow' | 'deny' | 'row-dependent'

export type ListOperation = 'query' | 'create' | 'update' | 'delete'

/** One field's entry in a {@link SessionVocabulary}. */
export interface FieldVocabulary {
  readonly read: AccessAnswer
  readonly create: AccessAnswer
  readonly update: AccessAnswer
  /** Read is `'allow'`, the field has a Filter spec, and `isFilterable` is not false (ADR-0031). */
  readonly filterable: boolean
  /** Read is `'allow'` and a read can order by the field's column (ADR-0031). */
  readonly sortable: boolean
  /** The list a relationship field points at, and nothing about that list's access. */
  readonly relationship: { readonly targetList: string } | null
}

/**
 * What one session may be told about one list ahead of any request (ADR-0084).
 *
 * An operation answers `'allow'` when its rule returns `true` or a filter, and
 * `'deny'` when there is no rule or it returns `false`, `null` or `undefined`.
 * Disclosure only: Field Visibility and the Access Filter still decide every
 * read and write.
 */
export interface SessionVocabulary {
  readonly listKey: string
  readonly operations: Readonly<Record<ListOperation, AccessAnswer>>
  readonly fields: ReadonlyMap<string, FieldVocabulary>
}

const EVERY_OPERATION_ALLOWED: Readonly<Record<ListOperation, AccessAnswer>> = Object.freeze({
  query: 'allow',
  create: 'allow',
  update: 'allow',
  delete: 'allow',
})

async function answerOrDeny(
  subject: string,
  decide: () => Promise<AccessAnswer>,
): Promise<AccessAnswer> {
  try {
    return await decide()
  } catch (err) {
    console.warn(
      `[opensaas] The session vocabulary denies "${subject}": deciding its access threw.`,
      err,
    )
    return 'deny'
  }
}

function potentiallyAllowed(rule: AccessControl | undefined): AccessControl | undefined {
  if (rule === undefined) return undefined
  return async (args) => (await checkAccess(rule, args)) !== false
}

async function resolveOperations(
  context: AccessContext,
  listKey: string,
  operations: Partial<Record<ListOperation, AccessControl>> | undefined,
): Promise<Readonly<Record<ListOperation, AccessAnswer>>> {
  if (context._isSudo === true) return EVERY_OPERATION_ALLOWED
  const args = { session: context.session, context }
  const [query, create, update, del] = await Promise.all([
    answerOrDeny(`${listKey}.query`, async () =>
      (await checkAccess(operations?.query, args)) === false ? 'deny' : 'allow',
    ),
    answerOrDeny(`${listKey}.create`, () =>
      classifyRowIndependentCreateAccess(operations?.create, args),
    ),
    answerOrDeny(`${listKey}.update`, () =>
      classifyRowIndependentCreateAccess(potentiallyAllowed(operations?.update), args),
    ),
    answerOrDeny(`${listKey}.delete`, () =>
      classifyRowIndependentCreateAccess(potentiallyAllowed(operations?.delete), args),
    ),
  ])
  return { query, create, update, delete: del }
}

function hasFilterSpec(
  fieldName: string,
  field: FieldConfig,
  listKey: string,
  config: OpenSaasConfig,
): boolean {
  if (field.isFilterable === false || field.getFilterSpec === undefined) return false
  return field.getFilterSpec(fieldName, listKey, config) !== undefined
}

async function resolveField(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  operations: Readonly<Record<ListOperation, AccessAnswer>>,
  fieldName: string,
  field: FieldConfig,
): Promise<FieldVocabulary> {
  const args = { session: context.session, context }
  const ask = async (
    operation: 'read' | 'create' | 'update',
    gate: ListOperation,
    decide: () => Promise<AccessAnswer>,
  ): Promise<AccessAnswer> =>
    operations[gate] === 'deny'
      ? 'deny'
      : await answerOrDeny(`${listKey}.${fieldName} (${operation})`, decide)
  const [read, create, update] = await Promise.all([
    ask('read', 'query', () => classifyRowIndependentRead(field.access, args)),
    ask('create', 'create', () => classifyRowIndependentWrite(field.access, 'create', args)),
    ask('update', 'update', () => classifyRowIndependentWrite(field.access, 'update', args)),
  ])
  const readable = read === 'allow'
  return {
    read,
    create,
    update,
    filterable: readable && hasFilterSpec(fieldName, field, listKey, config),
    sortable: readable && (await hasColumnOrder(context, config, listKey, fieldName)),
    relationship: isRelationshipField(field) ? { targetList: field.ref.split('.')[0] } : null,
  }
}

/**
 * Resolve the {@link SessionVocabulary} of `listKey` for `context`'s session,
 * or `null` for a list the config does not declare. It never throws: a rule
 * that throws answers `'deny'` and is logged. Reached through
 * `context._sessionVocabulary`, which keeps the answer for the context's life.
 */
export async function resolveSessionVocabulary(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
): Promise<SessionVocabulary | null> {
  if (!Object.hasOwn(config.lists, listKey)) return null
  const listConfig = config.lists[listKey]
  const operations = await resolveOperations(context, listKey, listConfig.access?.operation)
  const entries = await Promise.all(
    Object.entries(listConfig.fields).map(
      async ([fieldName, field]): Promise<[string, FieldVocabulary]> => [
        fieldName,
        await resolveField(context, config, listKey, operations, fieldName, field),
      ],
    ),
  )
  return { listKey, operations, fields: new Map(entries) }
}
