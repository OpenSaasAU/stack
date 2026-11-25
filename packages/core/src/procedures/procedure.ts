import type * as z from 'zod'
import { processGlobal } from '../lib/process-global.js'

/** A surface a procedure can be reached through. */
export type ProcedureSurface = 'web' | 'mcp'

/** The surfaces a procedure is exposed on. Never empty. */
export type ProcedureExposure = readonly [ProcedureSurface, ...ProcedureSurface[]]

/**
 * The members of an application context a procedure may reach. The generated
 * `Context` satisfies it; a procedure is handed only these members, narrowed
 * at runtime by the host.
 */
export interface ProcedureHostContext {
  db: object
  session: object | null
  storage: object
  plugins: object
}

/**
 * What `access` and `run` receive as `context`: the secured `db`, the session,
 * storage and plugin services. `sudo()`, `unsafe`, `withSession()`,
 * `serverAction` and the engine's own face are absent, at runtime as well as
 * in the type.
 */
export interface ProcedureContext<C extends ProcedureHostContext> {
  readonly db: C['db']
  readonly session: C['session']
  readonly storage: C['storage']
  readonly plugins: C['plugins']
}

/** The argument a procedure's `access` rule receives. It never sees the input. */
export interface ProcedureAccessArgs<C extends ProcedureHostContext> {
  session: C['session']
  context: ProcedureContext<C>
}

/** The argument a procedure's `run` receives. */
export interface ProcedureRunArgs<C extends ProcedureHostContext, TInput> {
  input: TInput
  context: ProcedureContext<C>
}

/**
 * A procedure as written: every member is required.
 *
 * @typeParam C - the application's own context, usually the generated `Context`.
 * @typeParam TIn - the Zod schema the input is parsed with.
 * @typeParam TOut - the Zod schema the output is parsed with; keys it does not
 *   declare are removed before the result leaves the host.
 */
export interface ProcedureDefinition<
  C extends ProcedureHostContext,
  TIn extends z.ZodType,
  TOut extends z.ZodType,
> {
  /** What the procedure does, for the people and agents that call it. */
  description: string
  input: TIn
  output: TOut
  /**
   * Whether this session may call the procedure. Only `true` admits; a
   * procedure open to anonymous callers says so by returning `true` for a
   * `null` session.
   */
  access: (args: ProcedureAccessArgs<C>) => boolean | Promise<boolean>
  /** The surfaces that expose the procedure. A surface not named answers as an unknown name. */
  expose: ProcedureExposure
  run: (args: ProcedureRunArgs<C, z.output<TIn>>) => Promise<z.input<TOut>> | z.input<TOut>
}

/** A defined procedure, as the builder returns it and a registry holds it. */
export interface Procedure<
  C extends ProcedureHostContext,
  TIn extends z.ZodType = z.ZodType,
  TOut extends z.ZodType = z.ZodType,
> {
  readonly description: string
  readonly input: TIn
  readonly output: TOut
  readonly expose: ProcedureExposure
  access(args: ProcedureAccessArgs<C>): boolean | Promise<boolean>
  run(args: ProcedureRunArgs<C, z.output<TIn>>): Promise<z.input<TOut>> | z.input<TOut>
}

/**
 * An application's procedures, keyed by name. The registry is the
 * application's own module, given to each host at runtime, and is never part
 * of the config, so generation does not load it.
 */
export type ProcedureRegistry<C extends ProcedureHostContext> = Readonly<
  Record<string, Procedure<C>>
>

/** The builder the generated bundle binds to the application's own context. */
export type ProcedureBuilder<C extends ProcedureHostContext> = <
  TIn extends z.ZodType,
  TOut extends z.ZodType,
>(
  definition: ProcedureDefinition<C, TIn, TOut>,
) => Procedure<C, TIn, TOut>

/** Thrown when a procedure is defined without one of its required members. */
export class ProcedureDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcedureDefinitionError'
  }
}

const SURFACES: ReadonlySet<string> = new Set<ProcedureSurface>(['web', 'mcp'])

function isWeakSet(value: unknown): value is WeakSet<object> {
  return value instanceof WeakSet
}

function definedProcedures(): WeakSet<object> {
  return processGlobal('procedures', isWeakSet, () => new WeakSet<object>())
}

/** Whether `value` is a procedure the builder defined. */
export function isProcedure<C extends ProcedureHostContext>(value: unknown): value is Procedure<C> {
  return typeof value === 'object' && value !== null && definedProcedures().has(value)
}

function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === 'object' &&
    value !== null &&
    'safeParse' in value &&
    typeof value.safeParse === 'function'
  )
}

function assertExposure(expose: unknown): asserts expose is ProcedureExposure {
  if (!Array.isArray(expose) || expose.length === 0) {
    throw new ProcedureDefinitionError(
      "A procedure's `expose` must name at least one surface: 'web', 'mcp', or both.",
    )
  }
  const seen = new Set<string>()
  for (const surface of expose) {
    if (typeof surface !== 'string' || !SURFACES.has(surface) || seen.has(surface)) {
      throw new ProcedureDefinitionError(
        `A procedure's \`expose\` names each of 'web' and 'mcp' at most once; got ${JSON.stringify(expose)}.`,
      )
    }
    seen.add(surface)
  }
}

function assertDefinition<
  C extends ProcedureHostContext,
  TIn extends z.ZodType,
  TOut extends z.ZodType,
>(definition: ProcedureDefinition<C, TIn, TOut>): void {
  if (typeof definition.description !== 'string' || definition.description.trim() === '') {
    throw new ProcedureDefinitionError('A procedure needs a non-empty `description`.')
  }
  if (!isZodSchema(definition.input)) {
    throw new ProcedureDefinitionError('A procedure needs an `input` Zod schema.')
  }
  if (!isZodSchema(definition.output)) {
    throw new ProcedureDefinitionError('A procedure needs an `output` Zod schema.')
  }
  if (typeof definition.access !== 'function') {
    throw new ProcedureDefinitionError(
      'A procedure needs an `access` rule. One open to anonymous callers returns `true` for a `null` session.',
    )
  }
  if (typeof definition.run !== 'function') {
    throw new ProcedureDefinitionError('A procedure needs a `run` function.')
  }
  assertExposure(definition.expose)
}

/**
 * The procedure builder, bound to an application's context type. The
 * generated bundle calls this once in `.opensaas/procedures.ts`; an
 * application imports `procedure` from there rather than calling it itself.
 *
 * @throws {ProcedureDefinitionError} for a definition missing a required member.
 */
export function createProcedureBuilder<C extends ProcedureHostContext>(): ProcedureBuilder<C> {
  return <TIn extends z.ZodType, TOut extends z.ZodType>(
    definition: ProcedureDefinition<C, TIn, TOut>,
  ): Procedure<C, TIn, TOut> => {
    assertDefinition(definition)
    const { access, run } = definition
    const defined: Procedure<C, TIn, TOut> = Object.freeze({
      description: definition.description,
      input: definition.input,
      output: definition.output,
      expose: Object.freeze([...definition.expose]) satisfies ProcedureExposure,
      access: (args: ProcedureAccessArgs<C>) => access(args),
      run: (args: ProcedureRunArgs<C, z.output<TIn>>) => run(args),
    })
    definedProcedures().add(defined)
    return defined
  }
}
