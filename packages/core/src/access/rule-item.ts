// The `item` a field's `read` rule is handed: the row as the rule's view has it,
// behind a membrane that records a reach for a relation the row does not carry.
// See ADR-0082.

import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { getSyntheticFieldName } from '../fields/index.js'

/** What a level's `read` rules and hooks see in place of a caller-shaped relation. */
export interface RuleView {
  readonly removed: ReadonlySet<string>
  readonly declared: Readonly<Record<string, unknown>>
  /**
   * To-ones whose `null` stands for a row the session cannot see rather than no
   * row at all. A hook is still owed that `null` (ADR-0058); a rule is not.
   */
  readonly scopedAway: ReadonlySet<string>
}

const EMPTY_RULE_VIEW: RuleView = Object.freeze({
  removed: new Set<string>(),
  declared: {},
  scopedAway: new Set<string>(),
})

/** The {@link RuleView} of every row at one level, and of the levels beneath it. */
export interface RuleViewTree {
  readonly viewFor: (row: Record<string, unknown>) => RuleView
  readonly nested: Readonly<Record<string, RuleViewTree>>
}

export const NO_RULE_VIEWS: RuleViewTree = Object.freeze({
  viewFor: () => EMPTY_RULE_VIEW,
  nested: {},
})

/** A list's relation keys, each with the list it reaches when that is known. */
type RelationKeys = ReadonlyMap<string, string | undefined>

const NO_RELATIONS: RelationKeys = new Map()

const relationKeysByConfig = new WeakMap<OpenSaasConfig, ReadonlyMap<string, RelationKeys>>()

function relationKeysByList(config: OpenSaasConfig): ReadonlyMap<string, RelationKeys> {
  const known = relationKeysByConfig.get(config)
  if (known !== undefined) return known
  const byList = new Map<string, Map<string, string | undefined>>()
  const keysOf = (listKey: string): Map<string, string | undefined> => {
    const keys = byList.get(listKey) ?? new Map<string, string | undefined>()
    byList.set(listKey, keys)
    return keys
  }
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.type !== 'relationship' || !('ref' in fieldConfig)) continue
      if (typeof fieldConfig.ref !== 'string') continue
      const [relatedList, relatedField] = fieldConfig.ref.split('.')
      keysOf(listKey).set(fieldName, relatedList)
      if (relatedField === undefined) {
        keysOf(relatedList).set(getSyntheticFieldName(listKey, fieldName), listKey)
      }
    }
  }
  relationKeysByConfig.set(config, byList)
  return byList
}

function relationKeysOfFields(fieldConfigs: Record<string, FieldConfig>): RelationKeys {
  const keys = new Map<string, string | undefined>()
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type === 'relationship') keys.set(fieldName, undefined)
  }
  return keys
}

/** The keys a row's list reaches relations through. */
interface RowScope {
  readonly relations: RelationKeys
  readonly config: OpenSaasConfig | undefined
}

/** One row as `read` rules see it: built once per row, and shared by every rule on it. */
export interface RuleRow {
  /** The row under its {@link RuleView}, unguarded. Hooks read this; rules never do. */
  readonly item: Record<string, unknown>
  /** What a rule's guard stands in front of. */
  readonly target: Record<string, unknown>
  readonly fieldConfigs: Record<string, FieldConfig>
  readonly config: OpenSaasConfig | undefined
  readonly listKey: string | undefined
}

function viewedRow(row: Record<string, unknown>, view: RuleView): Record<string, unknown> {
  if (view.removed.size === 0 && Object.keys(view.declared).length === 0) return row
  const viewed: Record<string, unknown> = { ...row }
  for (const key of view.removed) delete viewed[key]
  Object.assign(viewed, view.declared)
  return viewed
}

/**
 * The {@link RuleRow} of one row of `listKey`. Without a config — a narrow unit
 * test exercising field access in isolation — the list's own relationship
 * fields are all that can be named.
 */
export function ruleRowOf(
  row: Record<string, unknown>,
  views: RuleViewTree,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig | undefined,
  listKey: string | undefined,
): RuleRow {
  const view = views.viewFor(row)
  const item = viewedRow(row, view)
  let target = item
  if (view.scopedAway.size > 0) {
    target = { ...item }
    for (const key of view.scopedAway) delete target[key]
  }
  return { item, target, fieldConfigs, config, listKey }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** What one evaluation of one rule has done to the row it was handed. */
interface Evaluation {
  tripped: boolean
  guards?: WeakMap<object, object>
}

function isFixedProperty(target: object, key: string | symbol): boolean {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
  return descriptor?.configurable === false && descriptor.writable === false
}

function scopeUnder(scope: RowScope, key: string | symbol): RowScope {
  const relatedList = typeof key === 'string' ? scope.relations.get(key) : undefined
  const relations =
    scope.config && relatedList
      ? (relationKeysByList(scope.config).get(relatedList) ?? NO_RELATIONS)
      : NO_RELATIONS
  return { relations, config: scope.config }
}

/**
 * The membrane's traps, for a row or for an array of rows, where `scope`
 * describes its elements. Rows below the one a rule was handed need no view of
 * their own: a relation carrying a nested include is shaped, so it never reached
 * the rule.
 *
 * A key is withheld only while the value under it is `undefined`. Every way of
 * asking about a key has a trap here, and on the row a rule was handed
 * enumeration answers for all of them at once: a spread copy would otherwise
 * carry the row's absence out from under the membrane, so a `root` withholding
 * anything trips on `ownKeys`. A `related` row does not: it never carries its
 * own relations, whatever the caller asked, so its absence has nothing to say.
 */
class Guard<T extends object> implements ProxyHandler<T> {
  constructor(
    private readonly evaluation: Evaluation,
    private readonly scope: RowScope,
    private readonly kind: 'root' | 'related' | 'array',
  ) {}

  private isWithheld(target: T, key: string | symbol): boolean {
    return (
      this.kind !== 'array' &&
      typeof key === 'string' &&
      this.scope.relations.has(key) &&
      Reflect.get(target, key) === undefined
    )
  }

  private refuse(): false {
    this.evaluation.tripped = true
    return false
  }

  private guarded(key: string | symbol, value: unknown): unknown {
    const scope = this.kind === 'array' ? this.scope : scopeUnder(this.scope, key)
    return guardValue(value, scope, this.evaluation)
  }

  get(target: T, key: string | symbol, receiver: unknown): unknown {
    if (this.isWithheld(target, key)) {
      this.evaluation.tripped = true
      return undefined
    }
    const value: unknown = Reflect.get(target, key, receiver)
    if (typeof value !== 'object' || value === null) return value
    return isFixedProperty(target, key) ? value : this.guarded(key, value)
  }

  has(target: T, key: string | symbol): boolean {
    return this.isWithheld(target, key) ? this.refuse() : Reflect.has(target, key)
  }

  ownKeys(target: T): (string | symbol)[] {
    if (this.kind === 'root') {
      for (const key of this.scope.relations.keys()) {
        if (Reflect.get(target, key) === undefined) this.evaluation.tripped = true
      }
    }
    return Reflect.ownKeys(target)
  }

  getOwnPropertyDescriptor(target: T, key: string | symbol): PropertyDescriptor | undefined {
    if (this.isWithheld(target, key)) {
      this.evaluation.tripped = true
      return undefined
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
    if (descriptor === undefined || !('value' in descriptor)) return descriptor
    if (isFixedProperty(target, key)) return descriptor
    return { ...descriptor, value: this.guarded(key, descriptor.value) }
  }

  set(): boolean {
    return this.refuse()
  }

  defineProperty(): boolean {
    return this.refuse()
  }

  deleteProperty(): boolean {
    return this.refuse()
  }

  setPrototypeOf(): boolean {
    return this.refuse()
  }

  preventExtensions(): boolean {
    return this.refuse()
  }
}

/**
 * Anything a rule could write through. A `Date` is copied because its methods
 * need the real object; any other class instance — a `Decimal`, a `Buffer` — is
 * handed over as it stands.
 */
function guardValue(value: unknown, scope: RowScope, evaluation: Evaluation): unknown {
  if (typeof value !== 'object' || value === null) return value
  const guards = (evaluation.guards ??= new WeakMap())
  const known = guards.get(value)
  if (known !== undefined) return known
  let guarded: object | undefined
  if (Array.isArray(value)) guarded = new Proxy(value, new Guard(evaluation, scope, 'array'))
  else if (value instanceof Date) guarded = new Date(value.getTime())
  else if (isPlainObject(value)) guarded = new Proxy(value, new Guard(evaluation, scope, 'related'))
  if (guarded === undefined) return value
  guards.set(value, guarded)
  return guarded
}

/**
 * The `item` for one evaluation of one rule, and whether that evaluation has
 * reached for something withheld or written through the row.
 */
export function guardedRuleItem(row: RuleRow): {
  readonly item: Record<string, unknown>
  readonly tripped: () => boolean
} {
  const { target, fieldConfigs, config, listKey } = row
  const relations =
    config && listKey
      ? (relationKeysByList(config).get(listKey) ?? NO_RELATIONS)
      : relationKeysOfFields(fieldConfigs)
  const evaluation: Evaluation = { tripped: false }
  return {
    item: new Proxy(target, new Guard(evaluation, { relations, config }, 'root')),
    tripped: () => evaluation.tripped,
  }
}
