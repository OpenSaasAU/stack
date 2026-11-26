import * as z from 'zod'
import { findMcpToolOwner, isReservedMcpToolName } from '../config/mcp-tool-names.js'
import type { OpenSaasConfig } from '../config/types.js'
import { isProcedure } from './procedure.js'
import { isReservedFailureCode } from './result.js'

/** Thrown when a host is created over options or a registry it cannot serve. */
export class ProcedureHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcedureHostError'
  }
}

/** Which of a procedure's two schemas a refusal is about. */
export type ProcedureSchemaSide = 'input' | 'output'

/** The schemas a host checks. Every procedure the builder defines carries them. */
export interface ProcedureSchemas {
  readonly input: z.ZodType
  readonly output: z.ZodType
}

/** What {@link assertProcedureRegistry} checks a registry against. */
export interface ProcedureRegistryChecks {
  /**
   * The resolved config. With it, a procedure named like one of its list
   * custom tools or plugin-registered MCP tools is refused. Without it only
   * the reserved generated-tool pattern is checked.
   */
  config?: OpenSaasConfig
}

const PROCEDURE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

type SchemaPath = readonly (string | number)[]

interface Finding {
  path: SchemaPath
  problem: string
  fix: string
}

const COMBINATORS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf'])

function describePath(side: ProcedureSchemaSide, path: SchemaPath): string {
  let described: string = side
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]
    if (segment === 'properties') {
      described += `.${String(path[++index])}`
    } else if (segment === 'prefixItems') {
      described += `[${String(path[++index])}]`
    } else if (segment === 'items') {
      described += '[]'
    } else if (segment === 'additionalProperties') {
      described += '[key]'
    } else if (typeof segment === 'string' && COMBINATORS.has(segment)) {
      index++
    }
  }
  return described
}

function isOpenEnded(schema: z.core.$ZodType): boolean {
  const { type } = schema._zod.def
  return type === 'any' || type === 'unknown'
}

const JSON_VALUE_OPTIONS = 'array,boolean,null,number,record,string'

function isJsonValue(schema: z.core.$ZodType): boolean {
  if (!(schema instanceof z.core.$ZodLazy)) return false
  const union = schema._zod.innerType
  if (!(union instanceof z.core.$ZodUnion)) return false
  const { options } = union._zod.def
  const kinds = options.map((option) => option._zod.def.type).sort()
  return (
    kinds.join(',') === JSON_VALUE_OPTIONS &&
    options.every((option) => {
      if (option instanceof z.core.$ZodArray) return option._zod.def.element === schema
      if (option instanceof z.core.$ZodRecord) return option._zod.def.valueType === schema
      return true
    })
  )
}

function openEndedFinding(
  schema: z.core.$ZodTypes,
  side: ProcedureSchemaSide,
  path: SchemaPath,
): Finding | undefined {
  const { def } = schema._zod
  if (def.type === 'any' || def.type === 'unknown') {
    return {
      path,
      problem: `is \`z.${def.type}()\`, which accepts any value`,
      fix: 'Declare the shape it carries, for example `z.string()` or `z.object({ … })`.',
    }
  }
  if (isJsonValue(schema)) {
    return {
      path,
      problem: 'is `z.json()` or its equivalent, which accepts any JSON value',
      fix: 'Declare the shape it carries, for example `z.string()` or `z.object({ … })`.',
    }
  }
  if (def.type === 'file') {
    return {
      path,
      problem: 'is `z.file()`, which a JSON body cannot carry',
      fix: 'Carry the bytes as a base64 string with `z.base64()`, or upload the file to storage and pass its reference.',
    }
  }
  if (def.type === 'object' && def.catchall !== undefined) {
    if (isOpenEnded(def.catchall)) {
      return {
        path,
        problem:
          'is a loose object (`z.looseObject` or `.passthrough()`), which lets undeclared keys through',
        fix: 'Use `z.object({ … })`, which removes undeclared keys, or `z.strictObject({ … })`, which refuses them.',
      }
    }
    if (side === 'output' && def.catchall._zod.def.type !== 'never') {
      return {
        path,
        problem: 'has a `.catchall()`, which returns keys the schema does not declare',
        fix: 'Use `z.object({ … })` or `z.strictObject({ … })`, or a `z.record` with a declared value type when the value is a map.',
      }
    }
  }
  if (def.type === 'record' && def.mode === 'loose') {
    return {
      path,
      problem:
        'is a `z.looseRecord`, which lets keys its key schema does not match through with any value',
      fix: 'Use `z.record`, which refuses a key its key schema does not match.',
    }
  }
  if (def.type === 'record' && isOpenEnded(def.valueType)) {
    return {
      path,
      problem: 'is a `z.record` of values of any type',
      fix: 'Declare the value type, for example `z.record(z.string(), z.string())`.',
    }
  }
  return undefined
}

const NO_VALUE_FIX =
  'For a procedure that takes no input use `z.object({}).optional()`; for one that returns nothing use `z.null()` and return `null`.'

const UNREPRESENTABLE_FIXES: Readonly<Record<string, string>> = {
  date: 'Use `z.iso.datetime()` and carry the date as an ISO string.',
  bigint: 'Use `z.string()` and carry the value as a decimal string, or `z.int()` when it fits.',
  transform:
    'Move the transform into `run` and declare the shape `run` returns; an input schema may still transform.',
  undefined: NO_VALUE_FIX,
  void: NO_VALUE_FIX,
  map: 'Use `z.record` with a declared value type.',
  set: 'Use `z.array`.',
  symbol: 'Use `z.string()`.',
  nan: 'Use `z.number()`.',
  custom: 'Use a built-in Zod type that describes the value.',
  function: 'Use a built-in Zod type that describes the value.',
}

const GENERIC_FIX = 'Use a schema whose values JSON can carry.'

const LITERAL_UNDEFINED_FIX =
  'Use `z.null()` for an empty value, or make the key optional with `.optional()`.'

interface Unrepresentable {
  path: SchemaPath
  schema: z.core.$ZodTypes
  message: string
}

function unrepresentableFix(schema: z.core.$ZodTypes): string {
  const { def } = schema._zod
  if (def.type !== 'literal') return UNREPRESENTABLE_FIXES[def.type] ?? GENERIC_FIX
  const first = def.values.find((value) => value === undefined || typeof value === 'bigint')
  return typeof first === 'bigint'
    ? (UNREPRESENTABLE_FIXES.bigint ?? GENERIC_FIX)
    : LITERAL_UNDEFINED_FIX
}

function byPath(left: { path: SchemaPath }, right: { path: SchemaPath }): number {
  return left.path.join('/').localeCompare(right.path.join('/'))
}

function isCatchallOf(candidate: SchemaPath, parent: SchemaPath): boolean {
  return (
    candidate.length === parent.length + 1 &&
    candidate[parent.length] === 'additionalProperties' &&
    parent.every((segment, index) => candidate[index] === segment)
  )
}

function assertSchemaSide(name: string, side: ProcedureSchemaSide, schema: z.ZodType): void {
  const findings: Finding[] = []
  const unrepresentable: Unrepresentable[] = []
  try {
    z.toJSONSchema(schema, {
      io: side,
      unrepresentable: ({ zodSchema, path, message }) => {
        unrepresentable.push({ path, schema: zodSchema, message })
        return 'throw'
      },
      override: ({ zodSchema, path }) => {
        const finding = openEndedFinding(zodSchema, side, path)
        if (finding !== undefined) findings.push(finding)
      },
    })
  } catch (error) {
    const located = unrepresentable[0]
    if (located === undefined) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ProcedureHostError(
        `Procedure "${name}": the ${side} schema cannot be converted to JSON Schema, and Zod does not say which part of it is at fault (${reason}). Change the schema until \`z.toJSONSchema(schema, { io: '${side}' })\` succeeds.`,
      )
    }
    throw new ProcedureHostError(
      `Procedure "${name}": \`${describePath(side, located.path)}\` cannot be converted to JSON Schema on its ${side} side (${located.message}). ${unrepresentableFix(located.schema)}`,
    )
  }

  const reported = findings
    .filter((finding) => !findings.some((parent) => isCatchallOf(finding.path, parent.path)))
    .sort(byPath)[0]
  if (reported !== undefined) {
    throw new ProcedureHostError(
      `Procedure "${name}": \`${describePath(side, reported.path)}\` ${reported.problem}. ${reported.fix}`,
    )
  }
}

/**
 * Refuses a procedure whose schemas cannot be carried on the wire: `input`
 * must convert to JSON Schema on its input side and `output` on its output
 * side, which rules out dates, bigints and output transforms, and neither may
 * hold `z.file()` or one of the open-ended shapes Zod provides, at any depth:
 * `z.any()`, `z.unknown()`, `z.json()`, a loose object, a `z.looseRecord` or a
 * `z.record` of `any`/`unknown`. An output object with a `.catchall()` is
 * refused too, because it returns keys the schema does not declare.
 *
 * A hand-written schema that accepts as much as those do, such as a recursive
 * union of every JSON type under another shape, is not recognised.
 *
 * Every host calls this when it is created.
 *
 * @throws {ProcedureHostError} naming the procedure, the offending part and the fix.
 */
export function assertProcedureSchemas(name: string, procedure: ProcedureSchemas): void {
  assertSchemaSide(name, 'input', procedure.input)
  assertSchemaSide(name, 'output', procedure.output)
}

function isResolvedConfig(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false
  const lists: unknown = Reflect.get(config, 'lists')
  return typeof lists === 'object' && lists !== null
}

/**
 * Refuses a procedure name that collides in the namespace procedures share
 * with MCP tools. A name matching the reserved `list_<list>_<operation>`
 * pattern is refused whether or not that generated tool is enabled, or its
 * list exists. With a `config`, a name a list custom tool or a
 * plugin-registered tool already carries is refused as well.
 *
 * @throws {ProcedureHostError} naming the procedure, what it clashes with and the fix.
 */
export function assertProcedureNamesAvailable(
  names: Iterable<string>,
  config?: OpenSaasConfig,
): void {
  if (config !== undefined && !isResolvedConfig(config)) {
    throw new ProcedureHostError(
      'The `config` a procedure host is given is not a resolved config. A config with plugins is a promise; pass the resolved one, `config: await config`.',
    )
  }
  for (const name of names) {
    if (isReservedMcpToolName(name)) {
      throw new ProcedureHostError(
        `Procedure "${name}": the name matches the reserved list_<list>_<operation> pattern of generated MCP tools. Rename the procedure, for example to a verb phrase such as "publishPost".`,
      )
    }
    const owner = config === undefined ? undefined : findMcpToolOwner(config, name)
    if (owner !== undefined) {
      throw new ProcedureHostError(
        `Procedure "${name}": the name is already taken by ${owner}. Procedures and MCP tools share one namespace; rename the procedure or that tool.`,
      )
    }
  }
}

/**
 * Everything a host checks about a registry when it is created: each name is
 * well formed, each entry was defined by the generated `procedure` builder,
 * each procedure's schemas can be carried on the wire
 * ({@link assertProcedureSchemas}) and no name collides with an MCP tool
 * ({@link assertProcedureNamesAvailable}).
 *
 * @throws {ProcedureHostError} naming the procedure, the offending part and the fix.
 */
export function assertProcedureRegistry(
  procedures: Readonly<Record<string, ProcedureSchemas>>,
  checks: ProcedureRegistryChecks = {},
): void {
  const names = Object.keys(procedures)
  for (const name of names) {
    if (!PROCEDURE_NAME.test(name)) {
      throw new ProcedureHostError(
        `Procedure name "${name}" must start with a letter and contain only letters, digits, "_" and "-" (at most 64 characters). Rename the registry key.`,
      )
    }
    const entry = procedures[name]
    if (!isProcedure(entry)) {
      throw new ProcedureHostError(
        `Registry entry "${name}" is not a procedure. Define it with the generated \`procedure\` builder.`,
      )
    }
    const reserved = Object.keys(entry.failures).find(isReservedFailureCode)
    if (reserved !== undefined) {
      throw new ProcedureHostError(
        `Procedure "${name}" declares the failure code "${reserved}", which is reserved. Declare a code of its own.`,
      )
    }
    assertProcedureSchemas(name, entry)
  }
  assertProcedureNamesAvailable(names, checks.config)
}
