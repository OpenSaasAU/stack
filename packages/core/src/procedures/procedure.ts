import type * as z from 'zod'
import { processGlobal } from '../lib/process-global.js'
import { DECLARED_FAILURE_CODE_PATTERN } from './codes.js'
import { procedureContextOf } from './context-face.js'
import { failWith, type ProcedureFail } from './failures.js'
import { isReservedFailureCode, type ProcedureResult, type ReservedFailureCode } from './result.js'

/** A surface a procedure can be reached through. */
export type ProcedureSurface = 'web' | 'mcp'

/** The surfaces a procedure is exposed on. Never empty. */
export type ProcedureExposure = readonly [ProcedureSurface, ...ProcedureSurface[]]

/**
 * The members of a transaction's context a procedure may reach. The generated
 * `Context`'s transaction context satisfies it.
 */
export interface ProcedureHostTransactionContext {
  db: object
  session: object | null
  storage: object
  plugins: object
  advisoryLock: (key: string) => Promise<void>
  transaction: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * The members of an application context a procedure may reach. The generated
 * `Context` satisfies it; a procedure is handed only these members, narrowed
 * at runtime.
 *
 * @typeParam Tx - the context `transaction` hands its callback.
 */
export interface ProcedureHostContext<
  Tx extends ProcedureHostTransactionContext = ProcedureHostTransactionContext,
> {
  db: object
  session: object | null
  storage: object
  plugins: object
  transaction: <T>(fn: (txContext: Tx) => Promise<T>) => Promise<T>
}

/** The context an application context's `transaction` hands its callback. */
export type TransactionContextOf<C> = C extends {
  transaction: (
    fn: (txContext: infer Tx extends ProcedureHostTransactionContext) => Promise<unknown>,
  ) => unknown
}
  ? Tx
  : never

/**
 * What a callback given to a procedure's `context.transaction` receives: the
 * transaction-bound `db`, whose reads can take a row lock with `.forUpdate()`,
 * the session, storage, plugin services and `advisoryLock`. It is narrowed at
 * runtime exactly as {@link ProcedureContext} is. `transaction` on it joins
 * the open transaction and hands its callback this same context.
 *
 * @typeParam Tx - the application's own transaction context, usually
 *   `TransactionContextOf<Context>`.
 */
export interface ProcedureTransactionContext<Tx extends ProcedureHostTransactionContext> {
  readonly db: Tx['db']
  readonly session: Tx['session']
  readonly storage: Tx['storage']
  readonly plugins: Tx['plugins']
  /**
   * Take PostgreSQL's transaction-scoped advisory lock on `key`, waiting until
   * it is free. Released when the transaction ends.
   */
  readonly advisoryLock: (key: string) => Promise<void>
  readonly transaction: <T>(
    fn: (txContext: ProcedureTransactionContext<Tx>) => Promise<T>,
  ) => Promise<T>
}

/**
 * What `access` and `run` receive as `context`: the secured `db`, the session,
 * storage, plugin services and `transaction`. `sudo()`, `unsafe`,
 * `withSession()`, `serverAction` and the engine's own face are absent, at
 * runtime as well as in the type.
 */
export interface ProcedureContext<
  C extends ProcedureHostContext<Tx>,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
> {
  readonly db: C['db']
  readonly session: C['session']
  readonly storage: C['storage']
  readonly plugins: C['plugins']
  /**
   * Run `fn` inside one transaction; a throw anywhere in it, a declared
   * failure included, rolls every write in it back, and a declared failure
   * `fn` returns is treated as thrown. `run` opens no
   * transaction of its own, so work that must not hold row locks (an SMS, a
   * model call) sits outside this callback. The transaction runs at Read
   * Committed and takes no options; a concurrency-sensitive rule takes a row
   * lock inside it (ADR-0047).
   */
  readonly transaction: <T>(
    fn: (txContext: ProcedureTransactionContext<Tx>) => Promise<T>,
  ) => Promise<T>
}

/** The argument a procedure's `access` rule receives. It never sees the input. */
export interface ProcedureAccessArgs<
  C extends ProcedureHostContext<Tx>,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
> {
  session: C['session']
  context: ProcedureContext<C, Tx>
}

/** The argument a procedure's `run` receives. */
export interface ProcedureRunArgs<
  C extends ProcedureHostContext<Tx>,
  TInput,
  TCode extends string = never,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
> {
  input: TInput
  context: ProcedureContext<C, Tx>
  /**
   * Constructs one of the procedure's declared failures. **Throw** what it
   * returns: `throw fail('SLOT_FULL')`. One returned from `run` or from a
   * `context.transaction` callback is treated as thrown. A code the procedure
   * does not declare is a compile error.
   */
  fail: ProcedureFail<TCode>
}

/**
 * The failures a procedure declares: each code and the message a caller
 * receives with it. A code is upper-case letters, digits and `_`, starting
 * with a letter, and is never one of the reserved codes.
 */
export type ProcedureFailures<TCode extends string> = Readonly<Record<TCode, string>> &
  Readonly<Partial<Record<ReservedFailureCode, never>>>

/**
 * A procedure as written: every member but `failures` is required.
 *
 * @typeParam C - the application's own context, usually the generated `Context`.
 * @typeParam TIn - the Zod schema the input is parsed with.
 * @typeParam TOut - the Zod schema the output is parsed with. A default
 *   `z.object` removes keys it does not declare before the result leaves the
 *   host, and a strict one refuses them. The shapes Zod provides that do
 *   neither (`z.looseObject`, `.catchall()`, `z.unknown`, `z.json()`,
 *   `z.looseRecord`, a `z.record` of `any`/`unknown`) are refused when a host
 *   is created. A hand-written schema that accepts as much is not recognised.
 * @typeParam TCode - the failure codes the procedure declares.
 */
export interface ProcedureDefinition<
  C extends ProcedureHostContext<Tx>,
  TIn extends z.ZodType,
  TOut extends z.ZodType,
  TCode extends string = never,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
> {
  /** What the procedure does, for the people and agents that call it. */
  description: string
  input: TIn
  output: TOut
  /**
   * The named failures `run` may throw, as code and message. A caller
   * receives one as `{ success: false, error: { code, message } }`, which the
   * HTTP host answers with status 200. Declaring a reserved code is refused
   * when the procedure is defined.
   */
  failures?: ProcedureFailures<TCode>
  /**
   * Whether this session may call the procedure. Only `true` admits; a
   * procedure open to anonymous callers says so by returning `true` for a
   * `null` session.
   */
  access: (args: ProcedureAccessArgs<C, Tx>) => boolean | Promise<boolean>
  /** The surfaces that expose the procedure. A surface not named answers as an unknown name. */
  expose: ProcedureExposure
  /**
   * The OAuth scopes an MCP token must carry for the procedure to be listed
   * or called as a tool. Omitted, the config's `mcp.scopes.write` is
   * required, as for a custom tool that names none; `[]` requires none. Only
   * the MCP host reads it: the HTTP host authenticates by cookie, which
   * carries no scopes.
   */
  scopes?: readonly string[]
  /**
   * The action itself. It runs in no transaction unless it opens one with
   * `context.transaction`. The value it returns is parsed by `output` after
   * any such transaction has committed, so output that fails its schema is
   * `INTERNAL` and undoes nothing.
   */
  run: (
    args: ProcedureRunArgs<C, z.output<TIn>, TCode, Tx>,
  ) => Promise<z.input<TOut>> | z.input<TOut>
}

/**
 * A defined procedure, as the builder returns it and a registry holds it.
 * `access` and `run` take the application's own context and narrow it
 * themselves before the definition's functions see it.
 */
export interface Procedure<
  C extends ProcedureHostContext,
  TIn extends z.ZodType = z.ZodType,
  TOut extends z.ZodType = z.ZodType,
  TCode extends string = string,
> {
  readonly description: string
  readonly input: TIn
  readonly output: TOut
  readonly expose: ProcedureExposure
  /** The OAuth scopes an MCP token must carry, when the procedure names them. */
  readonly scopes?: readonly string[]
  /** The declared failures, as code and message. */
  readonly failures: Readonly<Partial<Record<TCode, string>>>
  access(args: { context: C }): boolean | Promise<boolean>
  run(args: { input: z.output<TIn>; context: C }): Promise<z.input<TOut>> | z.input<TOut>
}

/**
 * An application's procedures, keyed by name. The registry is the
 * application's own module, given to each host at runtime, and is never part
 * of the config, so generation does not load it.
 */
export type ProcedureRegistry<C extends ProcedureHostContext> = Readonly<
  Record<string, Procedure<C>>
>

/**
 * The result a caller of `TProcedure` receives: its parsed output, or a
 * failure whose code is a reserved code or one the procedure declares.
 */
export type ProcedureResultOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer _TIn, infer TOut, infer TCode>
    ? ProcedureResult<z.output<TOut>, TCode>
    : never

/** The builder the generated bundle binds to the application's own context. */
export type ProcedureBuilder<
  C extends ProcedureHostContext<Tx>,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
> = <TIn extends z.ZodType, TOut extends z.ZodType, TCode extends string = never>(
  definition: ProcedureDefinition<C, TIn, TOut, TCode, Tx>,
) => Procedure<C, TIn, TOut, TCode>

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

function assertFailures(description: string, failures: unknown): void {
  if (failures === undefined) return
  if (typeof failures !== 'object' || failures === null || Array.isArray(failures)) {
    throw new ProcedureDefinitionError(
      "A procedure's `failures` is an object of failure code to message.",
    )
  }
  for (const [code, message] of Object.entries(failures)) {
    if (!DECLARED_FAILURE_CODE_PATTERN.test(code)) {
      throw new ProcedureDefinitionError(
        `Failure code ${JSON.stringify(code)} must start with an upper-case letter and contain only upper-case letters, digits and "_" (at most 64 characters).`,
      )
    }
    if (isReservedFailureCode(code)) {
      throw new ProcedureDefinitionError(
        `Procedure ${JSON.stringify(description)} declares the failure code "${code}", which the stack reserves for its own failures. Declare a code of the procedure's own instead.`,
      )
    }
    if (typeof message !== 'string' || message.trim() === '') {
      throw new ProcedureDefinitionError(`Failure code "${code}" needs a non-empty message.`)
    }
  }
}

function assertScopes(scopes: unknown): void {
  if (scopes === undefined) return
  if (
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === 'string' && scope !== '' && !/\s/.test(scope))
  ) {
    throw new ProcedureDefinitionError(
      "A procedure's `scopes` is an array of OAuth scope names, each a non-empty string without whitespace.",
    )
  }
}

function declaredFailures<TCode extends string>(
  failures: Readonly<Record<TCode, string>> | undefined,
): Readonly<Partial<Record<TCode, string>>> {
  const none: Partial<Record<TCode, string>> = {}
  return Object.freeze({ ...(failures ?? none) })
}

function assertDefinition(definition: {
  description: unknown
  input: unknown
  output: unknown
  failures?: unknown
  access: unknown
  run: unknown
  expose: unknown
  scopes?: unknown
}): void {
  if (typeof definition.description !== 'string' || definition.description.trim() === '') {
    throw new ProcedureDefinitionError('A procedure needs a non-empty `description`.')
  }
  if (!isZodSchema(definition.input)) {
    throw new ProcedureDefinitionError('A procedure needs an `input` Zod schema.')
  }
  if (!isZodSchema(definition.output)) {
    throw new ProcedureDefinitionError('A procedure needs an `output` Zod schema.')
  }
  assertFailures(definition.description, definition.failures)
  if (typeof definition.access !== 'function') {
    throw new ProcedureDefinitionError(
      'A procedure needs an `access` rule. One open to anonymous callers returns `true` for a `null` session.',
    )
  }
  if (typeof definition.run !== 'function') {
    throw new ProcedureDefinitionError('A procedure needs a `run` function.')
  }
  assertExposure(definition.expose)
  assertScopes(definition.scopes)
}

/**
 * The procedure builder, bound to an application's context type. The
 * generated bundle calls this once in `.opensaas/procedures.ts`; an
 * application imports `procedure` from there rather than calling it itself.
 *
 * @throws {ProcedureDefinitionError} for a definition missing a required
 *   member, or declaring a malformed or reserved failure code.
 */
export function createProcedureBuilder<
  C extends ProcedureHostContext<Tx>,
  Tx extends ProcedureHostTransactionContext = TransactionContextOf<C>,
>(): ProcedureBuilder<C, Tx> {
  return <TIn extends z.ZodType, TOut extends z.ZodType, TCode extends string = never>(
    definition: ProcedureDefinition<C, TIn, TOut, TCode, Tx>,
  ): Procedure<C, TIn, TOut, TCode> => {
    assertDefinition(definition)
    const { access, run } = definition
    const failures = declaredFailures<TCode>(definition.failures)
    const fail = failWith(failures)
    const defined: Procedure<C, TIn, TOut, TCode> = Object.freeze({
      description: definition.description,
      input: definition.input,
      output: definition.output,
      expose: Object.freeze([...definition.expose]) satisfies ProcedureExposure,
      ...(definition.scopes === undefined ? {} : { scopes: Object.freeze([...definition.scopes]) }),
      failures,
      access: (args: { context: C }) => {
        const context = procedureContextOf<C, Tx>(args.context)
        return access({ session: context.session, context })
      },
      run: (args: { input: z.output<TIn>; context: C }) =>
        run({ input: args.input, context: procedureContextOf<C, Tx>(args.context), fail }),
    })
    definedProcedures().add(defined)
    return defined
  }
}
