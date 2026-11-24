import { isComputedField } from '../config/field-kind.js'
import type { NeedsObject, OpenSaasConfig } from '../config/types.js'
import { deriveListMemberTable } from '../contract/derive.js'
import { isNeedsArray, needsEntriesOf, relatedListOf } from '../contract/dependencies.js'
import type { ListMemberTable } from '../members/list-members.js'

/**
 * A `needs` declaration (ADR-0025) nothing can satisfy, refused at generation
 * rather than silently ignored at runtime.
 *
 * A declaration reaches only what it spells out (ADR-0051, ADR-0085), so there
 * is no closure to be cyclic or too deep.
 */
export interface NeedsClosureError {
  /** The list whose field declares the unsatisfiable `needs`. */
  listKey: string
  /** The field key within that list. */
  fieldKey: string
  /** The list keys on the offending chain, starting at `listKey`. */
  chain: string[]
  /**
   * `'invalid-dependency'` — an entry names nothing on its list, names a
   * computed field, or takes a value its kind does not; `'no-resolve-output'`
   * — the declaring field has no `resolveOutput` hook to consume it (ADR-0051).
   */
  reason: 'invalid-dependency' | 'no-resolve-output'
  message: string
}

/**
 * An array-form `needs` naming a relation whose target list has a computed
 * field with a relation in its own `needs`. Reported, never refused: the
 * declaration is valid and reaches one hop.
 */
export interface ChainedNeedsWarning {
  listKey: string
  fieldKey: string
  /** The relation the declaration names. */
  relation: string
  /** The computed field on the target list, as `List.field`. */
  target: string
  /** The object form that spells the chain out. */
  replacement: NeedsObject
  message: string
}

type Needs = readonly string[] | NeedsObject

/** A plain-JS config can put anything here, so nothing narrower is assumed. */
function isNeedsObject(value: unknown): value is NeedsObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** A `needs` declaration as the author would write it. */
function renderNeeds(needs: true | Needs): string {
  if (needs === true) return 'true'
  if (isNeedsArray(needs)) return `[${needs.map((name) => `'${name}'`).join(', ')}]`
  const entries = Object.entries(needs).map(([key, beneath]) => `${key}: ${renderNeeds(beneath)}`)
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

/** The declaration holding only the entry at `path`, as the author would write it. */
function renderPath(path: readonly string[], arrayForm: boolean): string {
  const [last] = path.slice(-1)
  return path
    .slice(0, -1)
    .reduceRight(
      (rendered, key) => `{ ${key}: ${rendered} }`,
      arrayForm ? `['${last}']` : `{ ${last}: … }`,
    )
}

/**
 * Validate that every `needs` entry, at every depth, names a stored column or
 * a relation of the list at that level (ADR-0051, ADR-0085), and that the
 * declaring field has a `resolveOutput` hook to consume it. The generated
 * `Lists.<List>.TypeInfo` types what the hook is handed from the declaration;
 * this is what refuses the declaration itself.
 *
 * @param config - The fully resolved OpenSaas config.
 * @returns All invalid `needs` entries, flattened across lists and fields.
 */
export function validateNeedsDeclarations(config: OpenSaasConfig): NeedsClosureError[] {
  const errors: NeedsClosureError[] = []
  let table: ListMemberTable | undefined
  const members = (): ListMemberTable => (table ??= deriveListMemberTable(config))

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!listConfig?.fields) continue

    for (const [fieldKey, fieldConfig] of Object.entries(listConfig.fields)) {
      const needs: Needs | undefined = fieldConfig?.needs
      if (needs === undefined) continue
      if (!isStringArray(needs) && !isNeedsObject(needs)) {
        errors.push({
          listKey,
          fieldKey,
          chain: [listKey],
          reason: 'invalid-dependency',
          message:
            `"${listKey}.${fieldKey}" declares a needs that is neither an array of field names ` +
            `nor an object.`,
        })
        continue
      }
      const entries = needsEntriesOf(needs)
      if (entries.length === 0) continue

      if (!fieldConfig?.hooks?.resolveOutput) {
        errors.push({
          listKey,
          fieldKey,
          chain: [listKey],
          reason: 'no-resolve-output',
          message:
            `"${listKey}.${fieldKey}" declares needs: ${renderNeeds(needs)} ` +
            `but has no resolveOutput hook, so nothing can consume the declaration. Add the ` +
            `hook that reads these dependencies, or remove \`needs\` from "${listKey}.${fieldKey}".`,
        })
        continue
      }

      const walk = (
        onList: string,
        declared: Needs,
        path: readonly string[],
        chain: readonly string[],
      ): void => {
        const fields = config.lists[onList]?.fields ?? {}
        for (const [name, beneath] of needsEntriesOf(declared)) {
          const here = [...path, name]
          const refuse = (why: string): void => {
            errors.push({
              listKey,
              fieldKey,
              chain: [...chain],
              reason: 'invalid-dependency',
              message:
                `"${listKey}.${fieldKey}" declares needs: ` +
                `${renderPath(here, isNeedsArray(declared))}, but ${why}`,
            })
          }
          const field = Object.hasOwn(fields, name) ? fields[name] : undefined
          const isRelation = field?.type === 'relationship' && 'ref' in field && !!field.ref
          if (field !== undefined && !isRelation && isComputed(config, onList, name)) {
            refuse(
              `"${name}" is a computed field on "${onList}". \`needs\` may only name stored ` +
                `columns and relations of the list at that level.`,
            )
            continue
          }
          const onListMembers =
            isRelation || field === undefined ? members().lists.get(onList) : undefined
          const related = onListMembers && relatedListOf(onListMembers, name)
          if (field === undefined && related === undefined) {
            refuse(`"${onList}" has no field named "${name}".`)
            continue
          }
          if (beneath === true) continue
          if (!isStringArray(beneath) && !isNeedsObject(beneath)) {
            refuse(
              `"${name}" must be true, an array of field names or a nested object, so ` +
                `"${onList}.${name}" cannot be declared this way.`,
            )
            continue
          }
          if (!isRelation && field !== undefined) {
            refuse(`"${name}" is a stored column on "${onList}", which takes only \`true\`.`)
            continue
          }
          if (related !== undefined) walk(related, beneath, here, [...chain, related])
        }
      }
      walk(listKey, needs, [], [listKey])
    }
  }

  return errors
}

function isComputed(config: OpenSaasConfig, listKey: string, fieldKey: string): boolean {
  const field = config.lists[listKey].fields[fieldKey]
  return isComputedField(field, fieldKey, listKey, config)
}

type NeedsNode = Map<string, NeedsNode | true>

/** How deep a suggested replacement spells a chain out. */
const CHAIN_MAX_DEPTH = 5

/**
 * Every array-form `needs` whose chain stopped at one hop when the runtime
 * fold was removed, each with the object form that spells the chain out.
 * Expects a config that passed {@link validateNeedsDeclarations}.
 */
export function findChainedNeeds(config: OpenSaasConfig): ChainedNeedsWarning[] {
  const table = deriveListMemberTable(config)
  const warnings: ChainedNeedsWarning[] = []

  const relatedOf = (listKey: string, key: string): string | undefined => {
    const members = table.lists.get(listKey)
    return members && relatedListOf(members, key)
  }
  const chainedFields = (listKey: string): [string, Needs][] =>
    Object.entries(config.lists[listKey]?.fields ?? {}).flatMap(([key, field]) => {
      const needs = field.needs
      if (!needs || !field.hooks?.resolveOutput) return []
      const reaches = needsEntriesOf(needs).some(([name]) => relatedOf(listKey, name) !== undefined)
      return reaches ? [[key, needs] satisfies [string, Needs]] : []
    })

  const spell = (listKey: string, needs: Needs, path: readonly string[], into: NeedsNode): void => {
    for (const [name, beneath] of needsEntriesOf(needs)) {
      const related = relatedOf(listKey, name)
      const existing = into.get(name)
      if (related === undefined) {
        into.set(name, true)
        continue
      }
      const node: NeedsNode = existing instanceof Map ? existing : new Map()
      if (beneath !== true) spell(related, beneath, path, node)
      else if (path.length < CHAIN_MAX_DEPTH) {
        for (const [key, chained] of chainedFields(related)) {
          const origin = `${related}.${key}`
          if (!path.includes(origin)) spell(related, chained, [...path, origin], node)
        }
      }
      into.set(name, node.size > 0 ? node : true)
    }
  }

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields ?? {})) {
      const needs = field.needs
      if (!needs || !isNeedsArray(needs) || !field.hooks?.resolveOutput) continue
      const origin = `${listKey}.${fieldKey}`
      const replacement: NeedsNode = new Map()
      spell(listKey, needs, [origin], replacement)
      for (const relation of needs) {
        const related = relatedOf(listKey, relation)
        if (related === undefined) continue
        for (const [targetField, targetNeeds] of chainedFields(related)) {
          const target = `${related}.${targetField}`
          if (target === origin) continue
          warnings.push({
            listKey,
            fieldKey,
            relation,
            target,
            replacement: needsOf(replacement),
            message:
              `"${origin}" declares needs: ${renderNeeds(needs)}, and "${target}" declares ` +
              `needs: ${renderNeeds(targetNeeds)} of its own, which "${origin}" does not receive: ` +
              `the array form reaches one hop. If its hook reads past "${relation}", declare ` +
              `needs: ${renderNeeds(needsOf(replacement))}, adding each column it reads off a ` +
              `row the object spells out. If it does not, declare needs: ` +
              `${renderNeeds(oneHop(needs))} to say so.`,
          })
        }
      }
    }
  }

  return warnings
}

function needsOf(node: NeedsNode): NeedsObject {
  return Object.fromEntries(
    [...node].map(([key, beneath]) => [key, beneath === true ? true : needsOf(beneath)]),
  )
}

function oneHop(needs: readonly string[]): NeedsObject {
  return Object.fromEntries(needs.map((name) => [name, true]))
}
