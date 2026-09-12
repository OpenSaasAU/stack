import type { AccessContext, OrmRow, Session } from '../access/types.js'
import type { FieldConfig, ListConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from '../access/engine.js'
import { classifyRowIndependentRead } from '../access/field-access.js'
import { decideAdvertisement } from './advertise.js'
import type { Refinement, SecuredRefinement } from '../secured/include.js'
import type { SecuredQuery } from '../secured/read.js'
import { RELATION_QUANTIFIERS, SCALAR_OPERATORS } from '../secured/operators.js'
import { orderByArgument, whereArgument } from './arguments.js'
import { MCP_NESTED_TAKE_DEFAULT, MCP_NESTED_TAKE_MAX } from './constants.js'

/** A scalar/virtual field in a `fields` projection is selected by naming it `true` — this advertises that, not the field's own value shape (`fieldToJsonSchema`, used for `create`/`update`, is a different schema entirely). */
function scalarSelectorSchema(fieldName: string): Record<string, unknown> {
  return { type: 'boolean', description: `Include the "${fieldName}" field` }
}

/**
 * `id`/`createdAt`/`updatedAt` are added to every list automatically and
 * excluded from `listConfig.fields` (CLAUDE.md's "System Fields"), so they
 * need their own selector entries at every level a `fields` projection can
 * name fields — a scalar-only loop over `listConfig.fields` would otherwise
 * never advertise or accept them. `id` is additionally forced into every
 * selection this module composes, never left to the caller: a record
 * projected down to none of its own identifying columns cannot be the target
 * of a follow-up `update`/`delete` call.
 */
function systemFieldProperties(): Record<string, unknown> {
  return {
    id: {
      type: 'boolean',
      description: 'Include the "id" field (always returned regardless of selection)',
    },
    createdAt: scalarSelectorSchema('createdAt'),
    updatedAt: scalarSelectorSchema('updatedAt'),
  }
}

function isSystemFieldName(name: string): name is 'id' | 'createdAt' | 'updatedAt' {
  return name === 'id' || name === 'createdAt' || name === 'updatedAt'
}

/**
 * Thrown when a `query` tool's `fields` argument names something the
 * generated projection schema does not advertise — an unknown field, a
 * relation two levels deeper than enumerated, or the wrong shape for what
 * it named. Caught in the MCP handler and turned into an `isError` tool
 * result (never a JSON-RPC protocol error, #995) naming what was asked for
 * and what is available, so the calling model can retry narrower.
 */
export class McpProjectionRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpProjectionRefusedError'
  }
}

function isRelationshipField(
  fieldConfig: FieldConfig | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
): fieldConfig is RelationshipField<any> {
  return (
    !!fieldConfig &&
    fieldConfig.type === 'relationship' &&
    'ref' in fieldConfig &&
    !!fieldConfig.ref
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
function isMany(fieldConfig: RelationshipField<any>): boolean {
  return fieldConfig.many === true
}

/**
 * Resolve a relation field's target list, or `null` if it should not be
 * advertised/selectable at all: the ref doesn't resolve, its MCP tools are
 * disabled (ADR-0033 — a list with `mcp.enabled: false` is unreachable
 * through MCP, including as a relation target), or this session's
 * operation-level `query` access on it is denied outright.
 */
async function relatedListIfVisible(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
  fieldConfig: RelationshipField<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
): Promise<{ listName: string; listConfig: ListConfig<any> } | null> {
  const related = getRelatedListConfig(fieldConfig.ref, config)
  if (!related) return null
  if (related.listConfig.mcp?.enabled === false) return null

  const queryAccess = related.listConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session, context })
  if (result === false) return null

  return related
}

/**
 * One field of a list this session may be told about, carrying its relation
 * target already resolved so that no second caller re-decides visibility.
 */
type AdvertisableField = {
  name: string
  relation: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
    fieldConfig: RelationshipField<any>
    listName: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    listConfig: ListConfig<any>
  } | null
}

async function decideField(
  fieldName: string,
  fieldConfig: FieldConfig,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
  options: { relationsSelectable: boolean },
): Promise<AdvertisableField | null> {
  const relationConfig = isRelationshipField(fieldConfig) ? fieldConfig : null
  if (relationConfig && !options.relationsSelectable) return null

  const answer = await classifyRowIndependentRead(fieldConfig.access, { session, context })
  if (answer === 'deny') return null

  if (!relationConfig) return { name: fieldName, relation: null }

  const related = await relatedListIfVisible(relationConfig, config, session, context)
  if (!related) return null

  return { name: fieldName, relation: { fieldConfig: relationConfig, ...related } }
}

/**
 * The fields of `listConfig` this session may be told about, in declaration
 * order: a field whose `read` rule is row-independent and denies is omitted, a
 * row-dependent one stays (it may pass for rows the session owns), and a
 * relation whose target list this session cannot reach at all is omitted as
 * well — ADR-0053.
 *
 * This is the one place the read vocabulary is decided. Both the advertised
 * schema and the refusal `resolveFieldsProjection` raises for an unnamed field
 * read it, so a dropped name is indistinguishable from one that never existed;
 * deriving either from `listConfig.fields` directly would leak back what the
 * schema withheld.
 *
 * `relationsSelectable: false` additionally drops relations, which is the
 * level-2 vocabulary (a relation named there terminates).
 *
 * Every call site decides a vocabulary — the advertised `tools/list` schema,
 * or the set `resolveFieldsProjection` validates a caller's `fields` argument
 * against (#1361) — never a fetched row, so a rule that throws while deciding
 * ANY field here (not only ones a caller happens to have named) is always
 * contained via {@link decideAdvertisement}: that field is simply absent from
 * the vocabulary this call returns, and the rule itself still runs — and can
 * still throw — the moment a caller-named field's value is actually read off
 * a fetched row.
 */
async function advertisableFields(
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
  options: { relationsSelectable: boolean },
): Promise<AdvertisableField[]> {
  const advertisable: AdvertisableField[] = []
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    const decided = await decideAdvertisement<AdvertisableField | null>(
      `${listKey}.${fieldName}`,
      () => decideField(fieldName, fieldConfig, config, session, context, options),
      null,
    )
    if (decided) advertisable.push(decided)
  }
  return advertisable
}

/**
 * Generate the JSON Schema for the `query` tool's `fields` projection
 * argument: two levels of the list's own vocabulary (ADR-0033). Level 1 is
 * this list's own scalar/virtual fields (booleans) and relations (nested
 * objects); level 2, inside a relation's own `fields`, is the related
 * list's scalar/virtual fields only — a relation named there terminates
 * (not itself selectable further), which is what keeps the schema finite
 * against a self-referential relationship. Denied/MCP-disabled relation
 * targets are omitted from the vocabulary entirely, per-session.
 */
export async function generateFieldsProjectionSchema(
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
): Promise<Record<string, unknown>> {
  const properties: Record<string, unknown> = systemFieldProperties()

  for (const { name: fieldName, relation } of await advertisableFields(
    listKey,
    listConfig,
    config,
    session,
    context,
    { relationsSelectable: true },
  )) {
    if (!relation) {
      properties[fieldName] = scalarSelectorSchema(fieldName)
      continue
    }

    const level2Properties: Record<string, unknown> = systemFieldProperties()
    for (const { name: relFieldName } of await advertisableFields(
      relation.listName,
      relation.listConfig,
      config,
      session,
      context,
      { relationsSelectable: false },
    )) {
      level2Properties[relFieldName] = scalarSelectorSchema(relFieldName)
    }

    const many = isMany(relation.fieldConfig)
    properties[fieldName] = {
      type: 'object',
      description: many
        ? `Select fields from the related ${relation.listName} records`
        : `Select fields from the related ${relation.listName} record`,
      properties: {
        fields: {
          type: 'object',
          description: `Fields to return from ${relation.listName}`,
          properties: level2Properties,
          additionalProperties: false,
        },
        ...(many
          ? {
              where: {
                type: 'object',
                description:
                  `Which ${relation.listName} rows to return, in the Where vocabulary: a field ` +
                  `name against a value or an operator object (${SCALAR_OPERATORS.join(', ')}), ` +
                  `a relation against ${RELATION_QUANTIFIERS.join('/')}, and AND, OR, NOT`,
              },
              orderBy: {
                type: 'object',
                description: `Sort order: ${relation.listName} column names against "asc" or "desc"`,
              },
              take: {
                type: 'number',
                description: `Max rows to return (default ${MCP_NESTED_TAKE_DEFAULT}, hard cap ${MCP_NESTED_TAKE_MAX})`,
              },
              skip: { type: 'number', description: 'Rows to skip' },
              count: {
                type: 'boolean',
                description:
                  'Return the total row count instead of, or alongside, the rows themselves',
              },
            }
          : {}),
      },
      ...(many ? {} : { required: ['fields'] }),
      additionalProperties: false,
    }
  }

  return {
    type: 'object',
    description:
      'Select which fields (and, for relations, which nested fields) to return. Omit to get scalars and virtuals only, unchanged from today.',
    properties,
    additionalProperties: false,
  }
}

/**
 * A resolved `fields` argument, as something to compose onto a read rather
 * than something to trim a result with (ADR-0053). The engine's own exact
 * selection is the only authority on what the caller receives, so this module
 * keeps nothing to project a row down with afterwards.
 */
export interface ResolvedFieldsProjection {
  /** Compose the caller's projection onto the read they asked it of. */
  apply(query: SecuredQuery): SecuredQuery
  /**
   * The rows the engine returned, at the shape the tool advertises. A
   * count-only relation is read as its rows beside the count — Field
   * Visibility decides a relation's fate against the value it was given, and a
   * `[]` stand-in fails open for a rule of the `item.comments.length === 0`
   * shape (`maskReductions` in `secured/read.ts`). Those rows are the engine's
   * business, not the caller's, so this drops them once it has decided.
   */
  toWire(rows: readonly OrmRow[]): OrmRow[]
}

/** The per-parent page a nested relation entry asked for, under the standing caps. */
function nestedPage(entry: Record<string, unknown>): { limit: number; offset?: number } {
  const requested = typeof entry.take === 'number' ? entry.take : MCP_NESTED_TAKE_DEFAULT
  return {
    limit: Math.min(requested, MCP_NESTED_TAKE_MAX),
    ...(typeof entry.skip === 'number' ? { offset: entry.skip } : {}),
  }
}

/**
 * The refinement one relation entry lowers to.
 *
 * A to-one is its own selection. A to-many is that selection under the entry's
 * `where`, sort and per-parent page. `count: true` becomes one `combine` with
 * the rows under `items` and the count under `count` — one include, one
 * correlated subquery, and the `{ items, count }` shape the tool already
 * returns. The count branch is composed off the unpaged refinement, so it
 * counts the relation rather than the page.
 *
 * A count asked for without `fields` takes that same shape rather than a bare
 * `count()`: the rows are what Field Visibility has to decide the relation's
 * fate against, and `ResolvedFieldsProjection.toWire` drops them afterwards.
 */
function relationRefinement(
  entry: Record<string, unknown>,
  selection: readonly string[],
  many: boolean,
  path: string,
): Refinement {
  const scope = (rows: SecuredRefinement): SecuredRefinement =>
    entry.where === undefined ? rows : rows.where(whereArgument(entry.where, `${path}.where`))

  if (!many) return (rows) => scope(rows).select(...selection)

  const page = nestedPage(entry)
  const items = (rows: SecuredRefinement): SecuredRefinement => {
    let composed = scope(rows).select(...selection)
    if (entry.orderBy !== undefined) {
      composed = composed.orderBy(orderByArgument(entry.orderBy, `${path}.orderBy`))
    }
    if (page.offset !== undefined) composed = composed.offset(page.offset)
    return composed.limit(page.limit)
  }

  if (entry.count !== true) return items
  return (rows) => rows.combine({ items: items(rows), count: scope(rows).count() })
}

/**
 * Validate a caller-supplied `fields` argument against the same vocabulary
 * {@link generateFieldsProjectionSchema} advertises, and translate it onto the
 * secured surface: this list's scalars and virtuals become one `.select()`
 * with `id` forced, and each relation becomes one `.include()` refinement
 * (ADR-0053). Every key, predicate and sort inside a refinement is resolved by
 * the engine when the read runs, exactly as it is for any other caller, so
 * nothing is validated twice.
 *
 * Throws {@link McpProjectionRefusedError} naming what was asked for and
 * what's available on any mismatch, rather than serving on a best-effort
 * basis.
 *
 * `advertisableFields` decides the same per-session vocabulary
 * {@link generateFieldsProjectionSchema} advertises, over EVERY field of the
 * list — not only the ones this caller named — so a rule that throws while
 * deciding a field the caller never asked for must not fail the caller's
 * query (#1361): that containment is built into `advertisableFields` itself.
 * A field lost to containment this way is simply absent from the vocabulary:
 * naming it explicitly below still refuses, exactly as an unknown field name
 * does, and the thrown rule itself still runs (and still throws) the moment
 * a caller-named field's value is actually read off a fetched row —
 * containment belongs to the vocabulary decision alone.
 */
export async function resolveFieldsProjection(
  fieldsArg: unknown,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
): Promise<ResolvedFieldsProjection> {
  if (fieldsArg === null || typeof fieldsArg !== 'object' || Array.isArray(fieldsArg)) {
    throw new McpProjectionRefusedError(
      `"fields" must be an object mapping field names to \`true\` or a relation selector.`,
    )
  }

  const advertisable = await advertisableFields(listKey, listConfig, config, session, context, {
    relationsSelectable: true,
  })
  const advertisableByName = new Map(advertisable.map((field) => [field.name, field]))

  // `id` is always selected, whether or not the caller asked for it — see
  // `systemFieldProperties`'s doc comment.
  const selection = new Set<string>(['id'])
  const relations: { name: string; refine: Refinement }[] = []
  const countOnly: string[] = []

  for (const [fieldName, rawValue] of Object.entries(fieldsArg)) {
    if (isSystemFieldName(fieldName)) {
      if (rawValue !== true) {
        throw new McpProjectionRefusedError(
          `"${listKey}.${fieldName}" is a scalar — select it with \`true\`, not ${JSON.stringify(rawValue)}.`,
        )
      }
      selection.add(fieldName)
      continue
    }

    const advertised = advertisableByName.get(fieldName)
    if (!advertised) {
      throw new McpProjectionRefusedError(
        `"${listKey}" has no field "${fieldName}". Available fields: ${advertisable
          .map((field) => field.name)
          .join(', ')}.`,
      )
    }

    const related = advertised.relation
    if (!related) {
      if (rawValue !== true) {
        throw new McpProjectionRefusedError(
          `"${listKey}.${fieldName}" is a scalar — select it with \`true\`, not ${JSON.stringify(rawValue)}.`,
        )
      }
      selection.add(fieldName)
      continue
    }

    if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}" is a relation — select it with an object, e.g. { "fields": { ... } }.`,
      )
    }

    const entry: Record<string, unknown> = rawValue
    const many = isMany(related.fieldConfig)
    const allowedKeys = many
      ? new Set(['fields', 'where', 'orderBy', 'take', 'skip', 'count'])
      : new Set(['fields'])
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) {
        throw new McpProjectionRefusedError(
          `"${listKey}.${fieldName}" does not accept "${key}" (allowed: ${[...allowedKeys].join(', ')}).`,
        )
      }
    }

    // Type-check each key before it reaches the engine — a malformed value
    // here would otherwise surface as a refusal about the related list rather
    // than about the selector shape that was expected.
    if (entry.where !== undefined && (entry.where === null || typeof entry.where !== 'object')) {
      throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.where" must be an object.`)
    }
    if (
      entry.orderBy !== undefined &&
      (entry.orderBy === null || typeof entry.orderBy !== 'object')
    ) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}.orderBy" must be an object or an array of objects.`,
      )
    }
    if (entry.take !== undefined && typeof entry.take !== 'number') {
      throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.take" must be a number.`)
    }
    if (entry.skip !== undefined && typeof entry.skip !== 'number') {
      throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.skip" must be a number.`)
    }
    if (entry.count !== undefined && typeof entry.count !== 'boolean') {
      throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.count" must be a boolean.`)
    }
    if (entry.take !== undefined && entry.take < 0) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}.take" must not be negative (nested reverse pagination isn't supported).`,
      )
    }
    if (entry.skip !== undefined && entry.skip < 0) {
      throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.skip" must not be negative.`)
    }

    const nestedFieldsArg = entry.fields
    const wantsCount = many && entry.count === true
    if (nestedFieldsArg === undefined && !wantsCount) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}" needs "fields"${many ? ' or "count"' : ''}.`,
      )
    }

    const nestedSelection = new Set<string>(['id'])
    if (nestedFieldsArg !== undefined) {
      if (
        nestedFieldsArg === null ||
        typeof nestedFieldsArg !== 'object' ||
        Array.isArray(nestedFieldsArg)
      ) {
        throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.fields" must be an object.`)
      }
      const relAdvertisable = new Set(
        (
          await advertisableFields(related.listName, related.listConfig, config, session, context, {
            relationsSelectable: false,
          })
        ).map((field) => field.name),
      )
      for (const [relFieldName, relValue] of Object.entries(nestedFieldsArg)) {
        if (!isSystemFieldName(relFieldName) && !relAdvertisable.has(relFieldName)) {
          throw new McpProjectionRefusedError(
            `"${related.listName}" has no selectable field "${relFieldName}" at this depth — relations ` +
              `are not selectable two levels deep; issue a second query for that.`,
          )
        }
        if (relValue !== true) {
          throw new McpProjectionRefusedError(
            `"${related.listName}.${relFieldName}" is a scalar — select it with \`true\`.`,
          )
        }
        nestedSelection.add(relFieldName)
      }
    }

    relations.push({
      name: fieldName,
      refine: relationRefinement(entry, [...nestedSelection], many, `${listKey}.${fieldName}`),
    })
    if (nestedFieldsArg === undefined && wantsCount) countOnly.push(fieldName)
  }

  return {
    apply(query) {
      let composed = query.select(...selection)
      for (const relation of relations) {
        composed = composed.include(relation.name, relation.refine)
      }
      return composed
    },
    toWire(rows) {
      if (countOnly.length === 0) return [...rows]
      return rows.map((row) => {
        const wire: OrmRow = { ...row }
        for (const name of countOnly) {
          const count = combinedCount(wire[name])
          if (count !== undefined) wire[name] = count
        }
        return wire
      })
    },
  }
}

/** The `count` of a `{ items, count }` value, where Field Visibility left one. */
function combinedCount(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!('count' in value)) return undefined
  const count: unknown = value.count
  return typeof count === 'number' ? count : undefined
}
