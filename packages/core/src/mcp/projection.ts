import type { AccessContext, Session } from '../access/types.js'
import type { FieldConfig, ListConfig, OpenSaasConfig, RelationshipField } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from '../access/engine.js'
import type { FieldSelection } from '../query/index.js'
import { pickFields } from '../query/index.js'
import { MCP_NESTED_TAKE_DEFAULT, MCP_NESTED_TAKE_MAX } from './constants.js'

/** A scalar/virtual field in a `fields` projection is selected by naming it `true` — this advertises that, not the field's own value shape (`fieldToJsonSchema`, used for `create`/`update`, is a different schema entirely). */
function scalarSelectorSchema(fieldName: string): Record<string, unknown> {
  return { type: 'boolean', description: `Include the "${fieldName}" field` }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
): Promise<Record<string, unknown>> {
  const properties: Record<string, unknown> = {}

  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    if (!isRelationshipField(fieldConfig)) {
      properties[fieldName] = scalarSelectorSchema(fieldName)
      continue
    }

    const related = await relatedListIfVisible(fieldConfig, config, session, context)
    if (!related) continue

    const level2Properties: Record<string, unknown> = {}
    for (const [relFieldName, relFieldConfig] of Object.entries(related.listConfig.fields)) {
      if (isRelationshipField(relFieldConfig)) continue
      level2Properties[relFieldName] = scalarSelectorSchema(relFieldName)
    }

    const many = isMany(fieldConfig)
    properties[fieldName] = {
      type: 'object',
      description: many
        ? `Select fields from the related ${related.listName} records`
        : `Select fields from the related ${related.listName} record`,
      properties: {
        fields: {
          type: 'object',
          description: `Fields to return from ${related.listName}`,
          properties: level2Properties,
          additionalProperties: false,
        },
        ...(many
          ? {
              where: { type: 'object', description: `Prisma where clause for ${related.listName}` },
              orderBy: { type: 'object', description: 'Sort order' },
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

/** What `resolveFieldsProjection` produces: a `context.db` `include` to fetch, the field selection to project the result down to, and which relations asked for a count. */
export type ResolvedFieldsProjection = {
  include: Record<string, unknown> | undefined
  fieldSelection: FieldSelection<unknown>
  countRequests: Map<string, 'only' | 'alongside'>
}

/** Access-scoped `_count.select` entry for one to-many relation: the related list's `query` access ANDed with any caller `where` on that same relation — mirrors how `buildAccessScopedInclude` scopes the relation's own rows (`andWhere`), since Prisma's `_count` is a sibling key that walk does not itself touch. */
async function accessScopedCountEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
  fieldConfig: RelationshipField<any>,
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
  callerWhere: Record<string, unknown> | undefined,
): Promise<true | { where: Record<string, unknown> } | null> {
  const related = getRelatedListConfig(fieldConfig.ref, config)
  if (!related) return null

  const queryAccess = related.listConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session, context })
  if (result === false) return null

  const accessWhere = typeof result === 'object' ? result : undefined
  const merged =
    accessWhere && callerWhere ? { AND: [accessWhere, callerWhere] } : (accessWhere ?? callerWhere)
  return merged ? { where: merged } : true
}

/**
 * Validate a caller-supplied `fields` argument against the same vocabulary
 * `generateFieldsProjectionSchema` advertises, and translate it into a
 * `context.db` `include` (so the normal read pipeline — access scoping,
 * `needs` folding, the depth cap — applies exactly as it does for any other
 * caller `include`; no parallel read path) plus a `FieldSelection` for
 * projecting the result down to what was asked for. Throws
 * `McpProjectionRefusedError` naming what was asked for and what's
 * available on any mismatch, never serves on a best-effort basis.
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

  const include: Record<string, unknown> = {}
  const fieldSelection: Record<string, unknown> = {}
  const countRequests = new Map<string, 'only' | 'alongside'>()
  let hasIncludeEntries = false

  for (const [fieldName, rawValue] of Object.entries(fieldsArg as Record<string, unknown>)) {
    const fieldConfig = listConfig.fields[fieldName]
    if (!fieldConfig) {
      throw new McpProjectionRefusedError(
        `"${listKey}" has no field "${fieldName}". Available fields: ${Object.keys(listConfig.fields).join(', ')}.`,
      )
    }

    if (!isRelationshipField(fieldConfig)) {
      if (rawValue !== true) {
        throw new McpProjectionRefusedError(
          `"${listKey}.${fieldName}" is a scalar — select it with \`true\`, not ${JSON.stringify(rawValue)}.`,
        )
      }
      fieldSelection[fieldName] = true
      continue
    }

    const related = await relatedListIfVisible(fieldConfig, config, session, context)
    if (!related) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}" is not available for selection — its related list is not ` +
          `queryable by this session, or has MCP disabled.`,
      )
    }

    if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}" is a relation — select it with an object, e.g. { "fields": { ... } }.`,
      )
    }

    const entry = rawValue as Record<string, unknown>
    const many = isMany(fieldConfig)
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

    const nestedFieldsArg = entry.fields
    const wantsCount = many && entry.count === true

    if (nestedFieldsArg === undefined && !wantsCount) {
      throw new McpProjectionRefusedError(
        `"${listKey}.${fieldName}" needs "fields"${many ? ' or "count"' : ''}.`,
      )
    }

    const nestedSelection: Record<string, true> = {}
    if (nestedFieldsArg !== undefined) {
      if (
        nestedFieldsArg === null ||
        typeof nestedFieldsArg !== 'object' ||
        Array.isArray(nestedFieldsArg)
      ) {
        throw new McpProjectionRefusedError(`"${listKey}.${fieldName}.fields" must be an object.`)
      }
      for (const [relFieldName, relValue] of Object.entries(
        nestedFieldsArg as Record<string, unknown>,
      )) {
        const relFieldConfig = related.listConfig.fields[relFieldName]
        if (!relFieldConfig || isRelationshipField(relFieldConfig)) {
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
        nestedSelection[relFieldName] = true
      }

      const includeEntry: Record<string, unknown> = {}
      if (many) {
        if (entry.where !== undefined) includeEntry.where = entry.where
        if (entry.orderBy !== undefined) includeEntry.orderBy = entry.orderBy
        const requestedTake =
          entry.take !== undefined ? Number(entry.take) : MCP_NESTED_TAKE_DEFAULT
        includeEntry.take = Math.min(requestedTake, MCP_NESTED_TAKE_MAX)
        if (entry.skip !== undefined) includeEntry.skip = entry.skip
      }
      include[fieldName] = Object.keys(includeEntry).length > 0 ? includeEntry : true
      hasIncludeEntries = true
      fieldSelection[fieldName] = { _type: 'fragment', _fields: nestedSelection }
    }

    if (wantsCount) {
      countRequests.set(fieldName, nestedFieldsArg !== undefined ? 'alongside' : 'only')
    }
  }

  if (countRequests.size > 0) {
    const countSelect: Record<string, unknown> = {}
    for (const fieldName of countRequests.keys()) {
      const fieldConfig = listConfig.fields[fieldName] as RelationshipField
      const rawEntry = (fieldsArg as Record<string, unknown>)[fieldName] as Record<string, unknown>
      const scoped = await accessScopedCountEntry(
        fieldConfig,
        config,
        session,
        context,
        rawEntry.where as Record<string, unknown> | undefined,
      )
      if (scoped) countSelect[fieldName] = scoped
    }
    if (Object.keys(countSelect).length > 0) {
      include._count = { select: countSelect }
      hasIncludeEntries = true
    }
  }

  return {
    include: hasIncludeEntries ? include : undefined,
    fieldSelection: fieldSelection as FieldSelection<unknown>,
    countRequests,
  }
}

/** Project one raw (already access-checked and field-visibility-filtered) result row down to a resolved `fields` projection, folding in any requested relation counts from Prisma's `_count`. */
export function projectMcpResult(
  rawItem: Record<string, unknown>,
  resolved: ResolvedFieldsProjection,
): Record<string, unknown> {
  const picked = pickFields(rawItem, resolved.fieldSelection) as Record<string, unknown>
  const rawCounts = rawItem._count
  const counts =
    rawCounts && typeof rawCounts === 'object' ? (rawCounts as Record<string, unknown>) : {}

  for (const [key, mode] of resolved.countRequests) {
    const count = typeof counts[key] === 'number' ? (counts[key] as number) : 0
    picked[key] = mode === 'only' ? count : { items: picked[key], count }
  }

  return picked
}
