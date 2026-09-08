// The stack-owned database errors and the driver classification that produces
// them (ADR-0042). A leaf module on purpose: the Engine stamp imports it, so a
// runtime import from here would put these classes behind a cycle with the
// surfaces that raise them.

/** SQLSTATE a driver reports for a unique-constraint or primary-key violation. */
const UNIQUE_VIOLATION_SQLSTATE = '23505'

/** SQLSTATE a driver reports for a serialization failure. */
const SERIALIZATION_FAILURE_SQLSTATE = '40001'

/**
 * The part of a driver's query error this module reads. Prisma 8's
 * `SqlQueryError` satisfies it structurally, which is what lets the
 * classification run without importing the ORM into a leaf module.
 *
 * `kind` alone identifies the error; the fields it carries stay `unknown` and
 * are narrowed where they are read. A driver that reports one of them in an
 * unexpected shape then loses only that field, rather than disabling the whole
 * classification — including the `40001` branch, which reads neither.
 */
interface DriverQueryError {
  readonly kind: 'sql_query'
  readonly sqlState?: unknown
  readonly constraint?: unknown
}

function isDriverQueryError(error: unknown): error is Error & DriverQueryError {
  if (!(error instanceof Error) || !('kind' in error)) return false
  const candidate: { kind?: unknown } = error
  return candidate.kind === 'sql_query'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * A database failure the stack owns, raised in place of the driver's own error
 * by every engine terminal (ADR-0042). Carries a message safe to show a user
 * and, where the failure names columns, one message per field. The driver's own
 * text is never the message — it is on {@link Error.cause}, for a server-side
 * log.
 *
 * The Unsafe surface is deliberately excluded: a query issued through it
 * rejects with the driver's own error, consistent with its bypassing
 * everything else.
 */
export class DatabaseError extends Error {
  /** One user-facing message per field the failure names. Empty when it names none. */
  public fieldErrors: Record<string, string>

  constructor(message: string, fieldErrors: Record<string, string> = {}, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseError'
    this.fieldErrors = fieldErrors
  }
}

/**
 * A transaction that could not be serialised against a concurrent one
 * (SQLSTATE `40001`).
 *
 * Retrying is the caller's decision and the caller's loop: the stack ships no
 * retry helper, and a loop that catches broadly rather than on
 * {@link isSerializationFailure} will re-apply a transaction that already
 * committed (ADR-0028).
 */
export class SerializationFailure extends DatabaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {}, options)
    this.name = 'SerializationFailure'
  }
}

/**
 * A write that collided with a unique constraint (SQLSTATE `23505`).
 *
 * {@link fields} and {@link fieldErrors} are populated when the violated
 * constraint is one the generator emitted, resolved through the generated
 * constraint map. A constraint managed by hand in the database is not in that
 * map, so it carries the generic message and no fields — the map's limit,
 * stated rather than hidden.
 */
export class UniqueConstraintViolation extends DatabaseError {
  /** The physical constraint name the driver reported, when it reported one. */
  public readonly constraintName: string | undefined
  /** The list the constraint is on, when the constraint map resolved it. */
  public readonly list: string | undefined
  /** The OpenSaas field keys the constraint covers, empty when unresolved. */
  public readonly fields: readonly string[]

  constructor(
    message: string,
    detail: {
      readonly constraintName?: string | undefined
      readonly list?: string | undefined
      readonly fields?: readonly string[]
      readonly fieldErrors?: Record<string, string>
    } = {},
    options?: ErrorOptions,
  ) {
    super(message, detail.fieldErrors ?? {}, options)
    this.name = 'UniqueConstraintViolation'
    this.constraintName = detail.constraintName
    this.list = detail.list
    this.fields = detail.fields ?? []
  }
}

/** Whether `error` is a serialization failure raised through the secured surface. */
export function isSerializationFailure(error: unknown): error is SerializationFailure {
  return error instanceof SerializationFailure
}

/** Whether `error` is a unique-constraint violation raised through the secured surface. */
export function isUniqueConstraintViolation(error: unknown): error is UniqueConstraintViolation {
  return error instanceof UniqueConstraintViolation
}

/** The generic message a unique violation carries when no field could be resolved. */
export const GENERIC_UNIQUE_VIOLATION_MESSAGE = 'A record with this value already exists'

/** The message a serialization failure carries. */
export const SERIALIZATION_FAILURE_MESSAGE =
  'This operation conflicted with another and was rolled back'

/**
 * The message an unclassified driver failure carries. The driver's own text
 * names columns, tables and constraint names, and a {@link DatabaseError}'s
 * message is what a server action hands a client, so the driver's text stays on
 * {@link Error.cause} for a server-side log rather than travelling to a browser.
 */
export const GENERIC_DATABASE_ERROR_MESSAGE = 'The database refused this operation'

/**
 * How far down a `cause` chain the driver's own error is looked for.
 *
 * Prisma 8 reports a failure raised at `COMMIT` as
 * `RuntimeError: Transaction commit failed` whose `cause` is the
 * `SqlQueryError` — the failure a `DEFERRABLE INITIALLY DEFERRED` constraint
 * produces by design. Verified at `8.0.0-rc.8`, where the wrapping is one
 * level deep; the small budget is headroom, not a claim about deeper nesting.
 */
const CAUSE_DEPTH = 4

// The walk stops at a DatabaseError rather than descending past it: an
// application that catches a stack error and rethrows its own with
// `{ cause }` — the standard Node idiom — has decided what its caller sees,
// and reaching through that decision to re-raise the driver failure would
// replace the application's error with the stack's. Prisma's own commit
// wrapper carries no DatabaseError, so the COMMIT case is unaffected.
function driverErrorWithin(error: unknown): (Error & DriverQueryError) | undefined {
  let candidate = error
  for (let depth = 0; depth <= CAUSE_DEPTH; depth++) {
    if (candidate instanceof DatabaseError) return undefined
    if (isDriverQueryError(candidate)) return candidate
    if (!(candidate instanceof Error)) return undefined
    candidate = candidate.cause
  }
  return undefined
}

/**
 * The stack-owned error for a driver query error, or `undefined` when `error`
 * neither is one nor wraps one — a hook's own throw, a validation failure, or
 * an error this module has already classified.
 *
 * Field resolution is NOT done here: the violated constraint's fields come
 * from the generated constraint map, which is reached through the config the
 * terminal does not hold. `normalizeDatabaseError` performs that second step
 * where the config is in scope.
 */
export function classifyDriverError(error: unknown): DatabaseError | undefined {
  const driver = driverErrorWithin(error)
  if (driver === undefined) return undefined

  const sqlState = asString(driver.sqlState)

  if (sqlState === SERIALIZATION_FAILURE_SQLSTATE) {
    return new SerializationFailure(SERIALIZATION_FAILURE_MESSAGE, { cause: error })
  }

  if (sqlState === UNIQUE_VIOLATION_SQLSTATE) {
    return new UniqueConstraintViolation(
      GENERIC_UNIQUE_VIOLATION_MESSAGE,
      { constraintName: asString(driver.constraint) },
      { cause: error },
    )
  }

  return new DatabaseError(GENERIC_DATABASE_ERROR_MESSAGE, {}, { cause: error })
}
