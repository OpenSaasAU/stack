import { AsyncLocalStorage } from 'node:async_hooks'
import type { FieldConfig, ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, AccessControl, OrmRow } from './types.js'
import { checkAccess } from './engine.js'
import {
  classifyRowIndependentCreateAccess,
  classifyRowIndependentRead,
  classifyRowIndependentWrite,
  classifyWriteForRow,
} from './field-access.js'
import { NO_RULE_VIEWS, ruleRowOf } from './rule-item.js'
import {
  controlFlowPredicateOf,
  decideAdvertisement,
  type AdvertisementPolicy,
} from './decide-advertisement.js'
import { resolveListMember, resolveListMembers, unhandledMember } from '../members/list-members.js'
import { resolveListTimestamps } from '../contract/derive.js'
import { isRelationshipField } from '../fields/index.js'
import { columnOrderedKeys } from '../secured/read.js'
import { readStoredRow, writeTargetAllows } from '../context/write-target.js'
import type { FilterSpec } from '../filter/types.js'
import {
  fieldFilterSpecOf,
  filterSpecsOf,
  withFieldFilterSpec,
  withFilterSpecs,
} from './vocabulary-filter-specs.js'

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

const vocabularyPolicy: AdvertisementPolicy = {
  warning: (subject) =>
    `[opensaas] The session vocabulary denies "${subject}": deciding its access threw.`,
}

const answering = new AsyncLocalStorage<ReadonlySet<AccessContext>>()

function isAnswering(context: AccessContext): boolean {
  return answering.getStore()?.has(context) === true
}

async function answerOrDeny(
  context: AccessContext,
  config: OpenSaasConfig,
  subject: string,
  decide: () => Promise<AccessAnswer>,
): Promise<AccessAnswer> {
  const within = new Set(answering.getStore())
  within.add(context)
  return await answering.run(within, () =>
    decideAdvertisement(
      subject,
      decide,
      'deny',
      vocabularyPolicy,
      controlFlowPredicateOf(context, config),
    ),
  )
}

function hasFilterSpec(field: FieldConfig): boolean {
  return typeof field.getFilterSpec === 'function' && field.isFilterable !== false
}

async function classifyWriteOperation(
  rule: AccessControl | undefined,
  args: { session: AccessContext['session']; context: AccessContext },
): Promise<AccessAnswer> {
  let returnedFilter = false
  const observed: AccessControl | undefined =
    rule === undefined
      ? undefined
      : async (ruleArgs) => {
          const result = await checkAccess(rule, ruleArgs)
          returnedFilter = typeof result === 'object'
          return result !== false
        }
  const answer = await classifyRowIndependentCreateAccess(observed, args)
  return answer === 'allow' && returnedFilter ? 'row-dependent' : answer
}

function once<T>(resolve: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | undefined
  return () => {
    if (kept !== undefined) return kept
    const resolving = resolve()
    kept = resolving
    resolving.catch(() => {
      if (kept === resolving) kept = undefined
    })
    return resolving
  }
}

const denied = async (): Promise<AccessAnswer> => 'deny'

const allowed = async (): Promise<AccessAnswer> => 'allow'

function operationQuestions(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  listConfig: ListConfig<TypeInfo>,
  singleton: boolean,
): Readonly<Record<ListOperation, () => Promise<AccessAnswer>>> {
  if (context._isSudo === true) {
    return {
      query: allowed,
      create: allowed,
      update: allowed,
      delete: singleton ? denied : allowed,
    }
  }
  const operations = listConfig.access?.operation
  const args = { session: context.session, context }
  return {
    query: once(() =>
      answerOrDeny(context, config, `${listKey}.query`, async () =>
        (await checkAccess(operations?.query, args)) !== false ? 'allow' : 'deny',
      ),
    ),
    create: once(() =>
      answerOrDeny(context, config, `${listKey}.create`, () =>
        classifyRowIndependentCreateAccess(operations?.create, args),
      ),
    ),
    update: once(() =>
      answerOrDeny(context, config, `${listKey}.update`, () =>
        classifyWriteOperation(operations?.update, args),
      ),
    ),
    delete: singleton
      ? denied
      : once(() =>
          answerOrDeny(context, config, `${listKey}.delete`, () =>
            classifyWriteOperation(operations?.delete, args),
          ),
        ),
  }
}

function storesWrites(config: OpenSaasConfig, listKey: string, fieldName: string): boolean {
  const member = resolveListMember(config, listKey, fieldName)
  if (member?.kind !== 'field') return false
  switch (member.storage.kind) {
    case 'computed':
      return false
    case 'relation':
      return member.storage.foreignKey !== undefined
    case 'column':
    case 'columns':
      return true
    default:
      return unhandledMember(member.storage)
  }
}

/**
 * The questions a {@link FieldVocabulary} answers, each asked only when it
 * is, and answered at most once.
 */
export interface FieldQuestions {
  readonly read: () => Promise<AccessAnswer>
  readonly create: () => Promise<AccessAnswer>
  readonly update: () => Promise<AccessAnswer>
  readonly filterable: () => Promise<boolean>
  readonly sortable: () => Promise<boolean>
  readonly relationship: { readonly targetList: string } | null
}

/**
 * The questions a {@link SessionVocabulary} answers for one list, each asked
 * only when it is and answered at most once, so a consumer that needs one
 * answer asks only the rules that answer needs. `whole` is the vocabulary
 * itself, assembled from the same answers (ADR-0084).
 */
export interface SessionVocabularyQuestions {
  readonly listKey: string
  readonly operation: (operation: ListOperation) => Promise<AccessAnswer>
  /** `undefined` for a name that is neither a field of the list nor one of its system fields. */
  readonly field: (fieldName: string) => FieldQuestions | undefined
  readonly whole: () => Promise<SessionVocabulary>
}

interface ListScope {
  readonly context: AccessContext
  readonly config: OpenSaasConfig
  readonly listKey: string
  readonly composable: boolean
  readonly operation: (operation: ListOperation) => Promise<AccessAnswer>
}

function sortableQuestion(
  scope: ListScope,
  fieldName: string,
  read: () => Promise<AccessAnswer>,
): () => Promise<boolean> {
  return once(
    async () =>
      scope.composable &&
      (await read()) === 'allow' &&
      (await columnOrderedKeys(scope.context, scope.config, scope.listKey, [fieldName])).has(
        fieldName,
      ),
  )
}

function declaredFieldQuestions(
  scope: ListScope,
  fieldName: string,
  field: FieldConfig,
): FieldQuestions {
  const { context, config, listKey } = scope
  const subject = `${listKey}.${fieldName}`
  const args = { session: context.session, context }
  const ask = (
    operation: 'read' | 'create' | 'update',
    gate: ListOperation,
    decide: () => Promise<AccessAnswer>,
  ): (() => Promise<AccessAnswer>) =>
    once(async () => {
      if (operation !== 'read' && !storesWrites(config, listKey, fieldName)) return 'deny'
      if ((await scope.operation(gate)) === 'deny') return 'deny'
      return await answerOrDeny(context, config, `${subject} (${operation})`, decide)
    })
  const read = ask('read', 'query', () => classifyRowIndependentRead(field.access, args))
  const filterSpec = once(async () =>
    scope.composable && hasFilterSpec(field) && (await read()) === 'allow'
      ? await decideAdvertisement<FilterSpec | undefined>(
          `${subject} (filter)`,
          async () => field.getFilterSpec?.(fieldName, listKey, config),
          undefined,
          vocabularyPolicy,
          controlFlowPredicateOf(context, config),
        )
      : undefined,
  )
  return withFieldFilterSpec(
    {
      read,
      create: ask('create', 'create', () =>
        classifyRowIndependentWrite(field.access, 'create', args),
      ),
      update: ask('update', 'update', () =>
        classifyRowIndependentWrite(field.access, 'update', args),
      ),
      filterable: async () => (await filterSpec()) !== undefined,
      sortable: sortableQuestion(scope, fieldName, read),
      relationship: isRelationshipField(field) ? { targetList: field.ref.split('.')[0] } : null,
    },
    filterSpec,
  )
}

function systemFieldNames(listConfig: ListConfig<TypeInfo>, config: OpenSaasConfig): string[] {
  const timestamps = resolveListTimestamps(listConfig, config.db)
  return [
    'id',
    ...(timestamps.createdAt ? ['createdAt'] : []),
    ...(timestamps.updatedAt ? ['updatedAt'] : []),
  ]
}

function systemFieldQuestions(scope: ListScope, fieldName: string): FieldQuestions {
  const read = async (): Promise<AccessAnswer> =>
    (await scope.operation('query')) === 'deny' ? 'deny' : 'allow'
  return withFieldFilterSpec(
    {
      read,
      create: denied,
      update: denied,
      filterable: async () => false,
      sortable: sortableQuestion(scope, fieldName, read),
      relationship: null,
    },
    async () => undefined,
  )
}

async function answerField(
  name: string,
  questions: FieldQuestions,
): Promise<[string, FieldVocabulary, FilterSpec | undefined]> {
  const [read, create, update, spec, sortable] = await Promise.all([
    questions.read(),
    questions.create(),
    questions.update(),
    fieldFilterSpecOf(questions),
    questions.sortable(),
  ])
  const entry: FieldVocabulary = {
    read,
    create,
    update,
    filterable: spec !== undefined,
    sortable,
    relationship: questions.relationship,
  }
  return [name, entry, spec]
}

async function assembleVocabulary(
  listKey: string,
  operation: (operation: ListOperation) => Promise<AccessAnswer>,
  fields: ReadonlyMap<string, FieldQuestions>,
): Promise<SessionVocabulary> {
  const [query, create, update, del] = await Promise.all([
    operation('query'),
    operation('create'),
    operation('update'),
    operation('delete'),
  ])
  const answered = await Promise.all(
    [...fields].map(([name, questions]) => answerField(name, questions)),
  )
  return withFilterSpecs(
    {
      listKey,
      operations: { query, create, update, delete: del },
      fields: new Map(answered.map(([name, entry]): [string, FieldVocabulary] => [name, entry])),
    },
    new Map(
      answered.flatMap(([name, , spec]): [string, FilterSpec][] =>
        spec === undefined ? [] : [[name, spec]],
      ),
    ),
  )
}

/**
 * The {@link SessionVocabularyQuestions} of `listKey` for `context`'s
 * session, or `null` for a list the config does not declare. Nothing is asked
 * until a question is. A rule that throws, or a field rule that returns a
 * filter, answers `'deny'` for that one question and is logged.
 */
export function sessionVocabularyQuestions(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
): SessionVocabularyQuestions | null {
  if (!Object.hasOwn(config.lists, listKey)) return null
  const listConfig = config.lists[listKey]
  const composable = !resolveListMembers(config, listKey).singleton
  const operations = operationQuestions(context, config, listKey, listConfig, !composable)
  const operation = (asked: ListOperation) => operations[asked]()
  const scope: ListScope = { context, config, listKey, composable, operation }
  const fields = new Map<string, FieldQuestions>([
    ...Object.entries(listConfig.fields).map(([name, field]): [string, FieldQuestions] => [
      name,
      declaredFieldQuestions(scope, name, field),
    ]),
    ...systemFieldNames(listConfig, config).map((name): [string, FieldQuestions] => [
      name,
      systemFieldQuestions(scope, name),
    ]),
  ])
  return {
    listKey,
    operation,
    field: (fieldName) => fields.get(fieldName),
    whole: once(() => assembleVocabulary(listKey, operation, fields)),
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
  return (await sessionVocabularyQuestions(context, config, listKey)?.whole()) ?? null
}

async function resolveOperationForRow(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  answer: AccessAnswer,
  operation: 'update' | 'delete',
  stored: { row: OrmRow; id: string | number },
): Promise<AccessAnswer> {
  if (answer !== 'row-dependent') return answer
  return await answerOrDeny(context, config, `${listKey}.${operation} (row)`, async () =>
    (await writeTargetAllows(context, config, listKey, stored.row, stored.id, operation))
      ? 'allow'
      : 'deny',
  )
}

function denyRowDependent(answer: AccessAnswer): AccessAnswer {
  return answer === 'row-dependent' ? 'deny' : answer
}

/**
 * `vocabulary` with its row-dependent write answers resolved for the row of
 * the list whose id is `id`: a field's `update`, and the list's `update` and
 * `delete`, each as the write decides it against that row as stored, the row
 * an update reads before it decides. A field's `read` is not resolved: Field
 * Visibility decides it on each read, against the row that read delivers, so
 * a row-dependent `read` stays `'row-dependent'`. Every other answer is
 * returned as it was, without asking its rule again. A row that is not there
 * answers each row-dependent write question deny. A field rule that reads the
 * payload stays `'row-dependent'`. Disclosure only, as the vocabulary is
 * (ADR-0084).
 */
export async function resolveSessionVocabularyForItem(
  context: AccessContext,
  config: OpenSaasConfig,
  vocabulary: SessionVocabulary,
  id: string | number,
): Promise<SessionVocabulary> {
  const { listKey } = vocabulary
  const listConfig = config.lists[listKey]
  const row = await readStoredRow(context, listKey, id)
  if (row === null) {
    const operations = {
      ...vocabulary.operations,
      update: denyRowDependent(vocabulary.operations.update),
      delete: denyRowDependent(vocabulary.operations.delete),
    }
    return withFilterSpecs(
      {
        listKey,
        operations,
        fields: new Map(
          [...vocabulary.fields].map(([name, entry]): [string, FieldVocabulary] => [
            name,
            {
              ...entry,
              update: operations.update === 'deny' ? 'deny' : denyRowDependent(entry.update),
            },
          ]),
        ),
      },
      filterSpecsOf(vocabulary),
    )
  }
  const stored = { row, id }
  const [update, del] = await Promise.all([
    resolveOperationForRow(
      context,
      config,
      listKey,
      vocabulary.operations.update,
      'update',
      stored,
    ),
    resolveOperationForRow(
      context,
      config,
      listKey,
      vocabulary.operations.delete,
      'delete',
      stored,
    ),
  ])
  const operations = { ...vocabulary.operations, update, delete: del }
  const args = { session: context.session, context }
  const ruleRow = ruleRowOf(row, NO_RULE_VIEWS, listConfig.fields, config, listKey)
  const fields = await Promise.all(
    [...vocabulary.fields].map(async ([name, entry]): Promise<[string, FieldVocabulary]> => {
      const field = Object.hasOwn(listConfig.fields, name) ? listConfig.fields[name] : undefined
      if (field === undefined) return [name, entry]
      const update =
        operations.update === 'deny'
          ? 'deny'
          : entry.update === 'row-dependent'
            ? await answerOrDeny(context, config, `${listKey}.${name} (update, row)`, () =>
                classifyWriteForRow(field.access, 'update', args, ruleRow),
              )
            : entry.update
      return [name, { ...entry, update }]
    }),
  )
  return withFilterSpecs(
    { listKey, operations, fields: new Map(fields) },
    filterSpecsOf(vocabulary),
  )
}

type QuestionsOf = (listKey: string) => SessionVocabularyQuestions | null

interface BoundVocabulary {
  readonly questionsOf: QuestionsOf
  readonly invalidate: () => void
}

/**
 * {@link sessionVocabularyQuestions} bound to `context`, kept per list until
 * `invalidate` is called, so each answer is asked at most once in between.
 */
function bindSessionVocabulary(context: AccessContext, config: OpenSaasConfig): BoundVocabulary {
  const memo = new Map<string, SessionVocabularyQuestions | null>()
  return {
    questionsOf: (listKey) => {
      const known = memo.get(listKey)
      if (known !== undefined) return known
      const questions = sessionVocabularyQuestions(context, config, listKey)
      memo.set(listKey, questions)
      return questions
    },
    invalidate: () => memo.clear(),
  }
}

function attachSessionVocabulary<TContext extends AccessContext>(
  context: TContext,
  config: OpenSaasConfig,
  bound: BoundVocabulary,
): TContext {
  const { questionsOf } = bound
  const vocabularyOf = async (listKey: string): Promise<SessionVocabulary | null> =>
    (await questionsOf(listKey)?.whole()) ?? null
  context._sessionVocabularyQuestions = questionsOf
  context._sessionVocabulary = vocabularyOf
  context._sessionVocabularyForItem = async (listKey, id) => {
    const vocabulary = await vocabularyOf(listKey)
    if (vocabulary === null) return null
    return await resolveSessionVocabularyForItem(context, config, vocabulary, id)
  }
  context._invalidateSessionVocabulary = bound.invalidate
  return context
}

/**
 * `context`, given its own memo of the {@link SessionVocabularyQuestions} of
 * each list, the vocabulary assembled from them, and
 * {@link resolveSessionVocabularyForItem} over it. A write that succeeds
 * through `context` clears the memo (ADR-0084).
 */
export function withOwnSessionVocabulary<TContext extends AccessContext>(
  context: TContext,
  config: OpenSaasConfig,
): TContext {
  return attachSessionVocabulary(context, config, bindSessionVocabulary(context, config))
}

/**
 * `context`, answering each ask of its vocabulary afresh: for a context held
 * for the life of the process, whose memo would outlive every data change a
 * rule reads (ADR-0084).
 */
export function withUnmemoisedSessionVocabulary<TContext extends AccessContext>(
  context: TContext,
  config: OpenSaasConfig,
): TContext {
  return attachSessionVocabulary(context, config, {
    questionsOf: (listKey) => sessionVocabularyQuestions(context, config, listKey),
    invalidate: () => undefined,
  })
}

/**
 * `derived`, a context a `resolveOutput` hook of a read through `parent` is
 * handed, sharing `parent`'s answers except while one of `parent`'s rules is
 * being asked: an ask made inside that is answered by `derived`'s own memo,
 * because `parent`'s answer may be the one waiting on it. A write through
 * `derived` clears both memos (ADR-0084).
 */
export function withDerivedSessionVocabulary<TContext extends AccessContext>(
  derived: TContext,
  parent: AccessContext,
  config: OpenSaasConfig,
): TContext {
  const shared = parent._sessionVocabularyQuestions
  if (shared === undefined) return withOwnSessionVocabulary(derived, config)
  let own: BoundVocabulary | undefined
  return attachSessionVocabulary(derived, config, {
    questionsOf: (listKey) => {
      if (!isAnswering(parent)) return shared(listKey)
      own ??= bindSessionVocabulary(derived, config)
      return own.questionsOf(listKey)
    },
    invalidate: () => {
      own?.invalidate()
      parent._invalidateSessionVocabulary?.()
    },
  })
}

/**
 * Make a write through `derived` also clear `receiver`'s memo, for a context
 * derived from `receiver` with `sudo()` or `withSession()` or for a write's
 * `afterTransaction` context.
 */
export function invalidatesSessionVocabularyOf<TContext extends AccessContext>(
  derived: TContext,
  receiver: AccessContext,
): TContext {
  const own = derived._invalidateSessionVocabulary
  derived._invalidateSessionVocabulary = () => {
    own?.()
    receiver._invalidateSessionVocabulary?.()
  }
  return derived
}
