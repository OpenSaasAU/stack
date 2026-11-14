import type { FieldConfig, ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, AccessControl } from './types.js'
import { checkAccess } from './engine.js'
import {
  classifyRowIndependentCreateAccess,
  classifyRowIndependentRead,
  classifyRowIndependentWrite,
} from './field-access.js'
import { decideAdvertisement, type AdvertisementPolicy } from './decide-advertisement.js'
import { isComputedField } from '../config/field-kind.js'
import { ownsForeignKey } from '../context/junction.js'
import { resolveListTimestamps } from '../contract/derive.js'
import { isRelationshipField } from '../fields/index.js'
import { canQueryList, hasFilterSpec } from '../filter/collect.js'
import { columnOrderedKeys } from '../secured/read.js'

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
  /** `'deny'` on a field that stores nothing and on a relationship side that does not own the foreign key. */
  readonly create: AccessAnswer
  /** `'deny'` on a field that stores nothing and on a relationship side that does not own the foreign key. */
  readonly update: AccessAnswer
  /** Read is `'allow'`, the field has a Filter spec, `isFilterable` is not false, and the list is not a singleton (ADR-0031). */
  readonly filterable: boolean
  /** Read is `'allow'`, a read can order by the field's column, and the list is not a singleton (ADR-0031). */
  readonly sortable: boolean
  /** The list a relationship field points at, and nothing about that list's access. */
  readonly relationship: { readonly targetList: string } | null
}

/**
 * What one session may be told about one list ahead of any request (ADR-0084).
 *
 * An operation answers `'allow'` when its rule returns `true` or a filter, and
 * `'deny'` when there is no rule or it returns `false`, `null` or `undefined`.
 * A singleton's `delete` is `'deny'` for every session, sudo included.
 * `fields` carries the list's system fields too: `id`, and `createdAt` and
 * `updatedAt` on a list with automatic timestamps, readable and never writable.
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

const vocabularyPolicy: AdvertisementPolicy = {
  warning: (subject) =>
    `[opensaas] The session vocabulary denies "${subject}": deciding its access threw.`,
}

async function answerOrDeny(
  subject: string,
  decide: () => Promise<AccessAnswer>,
): Promise<AccessAnswer> {
  return await decideAdvertisement(subject, decide, 'deny', vocabularyPolicy)
}

function potentiallyAllowed(rule: AccessControl | undefined): AccessControl | undefined {
  if (rule === undefined) return undefined
  return async (args) => (await checkAccess(rule, args)) !== false
}

async function resolveOperations(
  context: AccessContext,
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
  singleton: boolean,
): Promise<Readonly<Record<ListOperation, AccessAnswer>>> {
  if (context._isSudo === true) {
    return singleton ? { ...EVERY_OPERATION_ALLOWED, delete: 'deny' } : EVERY_OPERATION_ALLOWED
  }
  const operations = listConfig.access?.operation
  const args = { session: context.session, context }
  const [query, create, update, del] = await Promise.all([
    answerOrDeny(`${listKey}.query`, async () =>
      (await canQueryList(listConfig, args)) ? 'allow' : 'deny',
    ),
    answerOrDeny(`${listKey}.create`, () =>
      classifyRowIndependentCreateAccess(operations?.create, args),
    ),
    answerOrDeny(`${listKey}.update`, () =>
      classifyRowIndependentCreateAccess(potentiallyAllowed(operations?.update), args),
    ),
    singleton
      ? Promise.resolve<AccessAnswer>('deny')
      : answerOrDeny(`${listKey}.delete`, () =>
          classifyRowIndependentCreateAccess(potentiallyAllowed(operations?.delete), args),
        ),
  ])
  return { query, create, update, delete: del }
}

function storesWrites(
  fieldName: string,
  field: FieldConfig,
  listKey: string,
  config: OpenSaasConfig,
): boolean {
  if (isComputedField(field, fieldName, listKey, config)) return false
  return !isRelationshipField(field) || ownsForeignKey(config, listKey, fieldName, field)
}

type UnorderedFieldVocabulary = Omit<FieldVocabulary, 'sortable'>

async function resolveField(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  operations: Readonly<Record<ListOperation, AccessAnswer>>,
  composable: boolean,
  fieldName: string,
  field: FieldConfig,
): Promise<UnorderedFieldVocabulary> {
  const subject = `${listKey}.${fieldName}`
  const args = { session: context.session, context }
  const writable = storesWrites(fieldName, field, listKey, config)
  const ask = async (
    operation: 'read' | 'create' | 'update',
    gate: ListOperation,
    decide: () => Promise<AccessAnswer>,
  ): Promise<AccessAnswer> =>
    operations[gate] === 'deny' || (operation !== 'read' && !writable)
      ? 'deny'
      : await answerOrDeny(`${subject} (${operation})`, decide)
  const [read, create, update] = await Promise.all([
    ask('read', 'query', () => classifyRowIndependentRead(field.access, args)),
    ask('create', 'create', () => classifyRowIndependentWrite(field.access, 'create', args)),
    ask('update', 'update', () => classifyRowIndependentWrite(field.access, 'update', args)),
  ])
  const filterable =
    composable &&
    read === 'allow' &&
    (await decideAdvertisement(
      `${subject} (filter)`,
      async () =>
        hasFilterSpec(field) && field.getFilterSpec?.(fieldName, listKey, config) !== undefined,
      false,
      vocabularyPolicy,
    ))
  return {
    read,
    create,
    update,
    filterable,
    relationship: isRelationshipField(field) ? { targetList: field.ref.split('.')[0] } : null,
  }
}

function systemFieldNames(listConfig: ListConfig<TypeInfo>, config: OpenSaasConfig): string[] {
  const timestamps = resolveListTimestamps(listConfig, config.db)
  return [
    'id',
    ...(timestamps.createdAt ? ['createdAt'] : []),
    ...(timestamps.updatedAt ? ['updatedAt'] : []),
  ]
}

function systemField(readable: boolean): UnorderedFieldVocabulary {
  return {
    read: readable ? 'allow' : 'deny',
    create: 'deny',
    update: 'deny',
    filterable: false,
    relationship: null,
  }
}

/**
 * Resolve the {@link SessionVocabulary} of `listKey` for `context`'s session,
 * or `null` for a list the config does not declare. A rule that throws, or a
 * field rule that returns a filter, answers `'deny'` for that one question and
 * is logged.
 */
export async function resolveSessionVocabulary(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
): Promise<SessionVocabulary | null> {
  if (!Object.hasOwn(config.lists, listKey)) return null
  const listConfig = config.lists[listKey]
  const composable = !listConfig.isSingleton
  const operations = await resolveOperations(context, listKey, listConfig, !composable)
  const declared = await Promise.all(
    Object.entries(listConfig.fields).map(
      async ([fieldName, field]): Promise<[string, UnorderedFieldVocabulary]> => [
        fieldName,
        await resolveField(context, config, listKey, operations, composable, fieldName, field),
      ],
    ),
  )
  const readable = operations.query !== 'deny'
  const entries: [string, UnorderedFieldVocabulary][] = [
    ...declared,
    ...systemFieldNames(listConfig, config).map((name): [string, UnorderedFieldVocabulary] => [
      name,
      systemField(readable),
    ]),
  ]
  const probed = entries.filter(([, entry]) => entry.read === 'allow').map(([name]) => name)
  const ordered: ReadonlySet<string> =
    composable && probed.length > 0
      ? await columnOrderedKeys(context, config, listKey, probed)
      : new Set()
  return {
    listKey,
    operations,
    fields: new Map(
      entries.map(([name, entry]): [string, FieldVocabulary] => [
        name,
        { ...entry, sortable: ordered.has(name) },
      ]),
    ),
  }
}

/**
 * {@link resolveSessionVocabulary} bound to `context`, kept per list for the
 * life of the returned function. An answer that rejects is not kept.
 */
export function bindSessionVocabulary(
  context: AccessContext,
  config: OpenSaasConfig,
): (listKey: string) => Promise<SessionVocabulary | null> {
  const memo = new Map<string, Promise<SessionVocabulary | null>>()
  return (listKey) => {
    const known = memo.get(listKey)
    if (known !== undefined) return known
    const resolving = resolveSessionVocabulary(context, config, listKey)
    memo.set(listKey, resolving)
    resolving.catch(() => {
      if (memo.get(listKey) === resolving) memo.delete(listKey)
    })
    return resolving
  }
}

/** `context`, given its own {@link bindSessionVocabulary} resolver and memo. */
export function withOwnSessionVocabulary<TContext extends AccessContext>(
  context: TContext,
  config: OpenSaasConfig,
): TContext {
  context._sessionVocabulary = bindSessionVocabulary(context, config)
  return context
}
