import type { FieldKeys, Hooks, HookDb, TypeInfo } from '../config/types.js'

type StateOf<
  TTypeInfo extends TypeInfo,
  TField extends string,
> = TField extends keyof TTypeInfo['item']
  ? Extract<NonNullable<TTypeInfo['item'][TField]>, string>
  : string

type ListValidate<TTypeInfo extends TypeInfo> = NonNullable<
  Hooks<
    TTypeInfo['item'],
    TTypeInfo['inputs']['create'],
    TTypeInfo['inputs']['update'],
    HookDb<TTypeInfo>
  >['validate']
>

/** A state machine over one field, with no discriminator: flat `initial` and `from → to[]`. */
export interface FlatTransitionSpec<TState extends string, TField extends string> {
  field: TField
  discriminator?: undefined
  initial: readonly TState[]
  allowed: { [From in TState]?: readonly TState[] }
}

/** A state machine over one field, keyed by the value of a stored sibling field. */
export interface KeyedTransitionSpec<
  TState extends string,
  TKey extends string,
  TField extends string,
  TDiscriminator extends string,
> {
  field: TField
  discriminator: TDiscriminator
  initial: { [K in TKey]?: readonly TState[] }
  allowed: { [K in TKey]?: { [From in TState]?: readonly TState[] } }
}

export type TransitionSpec<
  TTypeInfo extends TypeInfo = TypeInfo,
  TField extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
  TDiscriminator extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | FlatTransitionSpec<StateOf<TTypeInfo, TField>, TField>
  | KeyedTransitionSpec<
      StateOf<TTypeInfo, TField>,
      StateOf<TTypeInfo, TDiscriminator>,
      TField,
      TDiscriminator
    >

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pick(resolved: unknown, item: unknown, key: string): unknown {
  if (isRecord(resolved) && key in resolved && resolved[key] !== undefined) return resolved[key]
  return isRecord(item) ? item[key] : undefined
}

function previousOf(item: unknown, key: string): unknown {
  return isRecord(item) ? item[key] : undefined
}

function lookup(map: unknown, key: unknown): unknown {
  if (!isRecord(map) || typeof key !== 'string') return undefined
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

function includes(list: unknown, value: unknown): boolean {
  return Array.isArray(list) && list.includes(value)
}

function legalUnderKey(initial: unknown, allowed: unknown, state: unknown): boolean {
  if (includes(initial, state)) return true
  if (!isRecord(allowed)) return false
  return Object.entries(allowed).some(
    ([source, targets]) => source === state || includes(targets, state),
  )
}

/**
 * Builds a list-level `validate` hook that enforces a state machine on one
 * `select` field, optionally keyed by a stored sibling field (the
 * `discriminator`). Because it is a `validate` hook it runs for every caller,
 * `sudo()` included, and checks a value set by `resolveInput` exactly like one
 * the caller supplied.
 *
 * - create: the state must be in `initial[key]` (flat `initial` without a discriminator)
 * - update that changes the field: the new state must be in `allowed[key][previous]`
 * - update that changes only the discriminator: the current state must be legal
 *   under the new key (an `initial` entry, or a source or target in `allowed`)
 * - update that changes neither, and delete: no check
 *
 * The guard takes no row lock, so concurrent updates from the same state can both pass; use
 * `context.transaction` with `.forUpdate()` where that matters. A create that omits the field is
 * checked as `undefined`, since database defaults are not visible to the hook.
 *
 * To combine it with a validation of your own, call both:
 *
 * ```ts
 * const guard = transitionGuard({ field: 'state', initial: ['DRAFT'], allowed: { DRAFT: ['SENT'] } })
 *
 * hooks: {
 *   validate: async (args) => {
 *     await guard(args)
 *     if (args.operation !== 'delete') {
 *       // ...your own checks
 *     }
 *   },
 * }
 * ```
 */
export function transitionGuard<
  TTypeInfo extends TypeInfo = TypeInfo,
  TField extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
  TDiscriminator extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
>(spec: TransitionSpec<TTypeInfo, TField, TDiscriminator>): ListValidate<TTypeInfo> {
  const { field, discriminator, initial, allowed } = spec
  const guard = async (args: {
    operation: 'create' | 'update' | 'delete'
    item?: unknown
    resolvedData?: unknown
    addValidationError: (msg: string) => void
  }): Promise<void> => {
    if (args.operation === 'delete') return
    const { item, resolvedData, addValidationError } = args
    const next = pick(resolvedData, item, field)
    const key = discriminator === undefined ? undefined : pick(resolvedData, item, discriminator)
    const previous = previousOf(item, field)
    const label =
      discriminator === undefined
        ? `"${field}"`
        : `"${field}" for ${discriminator} "${String(key)}"`

    const initialStates = discriminator === undefined ? initial : lookup(initial, key)
    const allowedMap = discriminator === undefined ? allowed : lookup(allowed, key)

    if (args.operation === 'create') {
      if (!includes(initialStates, next)) {
        addValidationError(`${label} cannot start as "${String(next)}"`)
      }
      return
    }

    if (next !== previous) {
      if (!includes(lookup(allowedMap, previous), next)) {
        addValidationError(`${label} cannot change from "${String(previous)}" to "${String(next)}"`)
      }
      return
    }

    if (discriminator !== undefined && key !== previousOf(item, discriminator)) {
      if (!legalUnderKey(initialStates, allowedMap, next)) {
        addValidationError(
          `${label} cannot stay "${String(next)}" under ${discriminator} "${String(key)}"`,
        )
      }
    }
  }
  return guard
}
