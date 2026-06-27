import type { Hooks } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'
import { validateWithZod } from '../validation/schema.js'
import { checkFieldAccess } from '../access/field-access.js'

/**
 * Validation error collection
 */
export class ValidationError extends Error {
  public errors: string[]
  public fieldErrors: Record<string, string>

  constructor(errors: string[], fieldErrors: Record<string, string> = {}) {
    super(`Validation failed: ${errors.join(', ')}`)
    this.name = 'ValidationError'
    this.errors = errors
    this.fieldErrors = fieldErrors
  }
}

/**
 * Database error with field-specific error information
 * Used for Prisma errors like unique constraint violations
 */
export class DatabaseError extends Error {
  public fieldErrors: Record<string, string>
  public code?: string

  constructor(message: string, fieldErrors: Record<string, string> = {}, code?: string) {
    super(message)
    this.name = 'DatabaseError'
    this.fieldErrors = fieldErrors
    this.code = code
  }
}

/**
 * Execute resolveInput hook
 * Allows modification of input data before validation
 */
export async function executeResolveInput<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        inputData: TCreateInput
        resolvedData: TCreateInput
        item: undefined
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        inputData: TUpdateInput
        resolvedData: TUpdateInput
        item: TOutput
        context: AccessContext
      },
): Promise<TCreateInput | TUpdateInput> {
  if (!hooks?.resolveInput) {
    return args.resolvedData
  }

  const result = await hooks.resolveInput(args)
  return result
}

/**
 * Execute validate hook (supports both 'validate' and deprecated 'validateInput')
 * Allows custom validation logic
 */
export async function executeValidate<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        inputData: TCreateInput
        resolvedData: TCreateInput
        item: undefined
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        inputData: TUpdateInput
        resolvedData: TUpdateInput
        item: TOutput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        item: TOutput
        context: AccessContext
      },
): Promise<void> {
  // Support both 'validate' (new) and 'validateInput' (deprecated) for backwards compatibility
  const validateHook = hooks?.validate || hooks?.validateInput
  if (!validateHook) {
    return
  }

  const errors: string[] = []

  const addValidationError = (msg: string) => {
    errors.push(msg)
  }

  await validateHook({
    ...args,
    addValidationError,
  } as Parameters<typeof validateHook>[0])

  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
}

/**
 * @deprecated Use executeValidate instead. This alias is provided for backwards compatibility.
 */
export const executeValidateInput = executeValidate

/**
 * Execute beforeOperation hook
 * Runs before database operation (cannot modify data)
 */
export async function executeBeforeOperation<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        inputData: TCreateInput
        resolvedData: TCreateInput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        inputData: TUpdateInput
        item: TOutput
        resolvedData: TUpdateInput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        item: TOutput
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.beforeOperation) {
    return
  }

  await hooks.beforeOperation(args as Parameters<typeof hooks.beforeOperation>[0])
}

/**
 * Execute afterOperation hook
 * Runs after database operation
 */
export async function executeAfterOperation<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        inputData: TCreateInput
        item: TOutput
        resolvedData: TCreateInput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        inputData: TUpdateInput
        originalItem: TOutput
        item: TOutput
        resolvedData: TUpdateInput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        originalItem: TOutput
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.afterOperation) {
    return
  }

  await hooks.afterOperation(args as Parameters<typeof hooks.afterOperation>[0])
}

/**
 * Execute list-level beforeTransaction hook (#590 / ADR-0010).
 *
 * Transaction-boundary hook: runs OUTSIDE the write's transaction, BEFORE it
 * opens. A throw here aborts the write (the transaction never opens). The
 * arguments mirror `beforeOperation` minus `resolvedData` (no input-shaping has
 * run yet at the transaction boundary).
 */
export async function executeBeforeTransaction<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        inputData: TCreateInput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        inputData: TUpdateInput
        item: TOutput | undefined
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        item: TOutput | undefined
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.beforeTransaction) {
    return
  }
  await hooks.beforeTransaction(args as Parameters<typeof hooks.beforeTransaction>[0])
}

/**
 * Execute list-level afterTransaction hook (#590 / ADR-0010).
 *
 * Transaction-boundary hook: runs OUTSIDE the write's transaction, AFTER it
 * settles, and ALWAYS runs when the paired `beforeTransaction` ran. The
 * `status` discriminant tells the hook whether the write committed (persisted
 * `item` present) or rolled back (no `item`, `error` present).
 */
export async function executeAfterTransaction<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        listKey: string
        operation: 'create'
        status: 'committed'
        inputData: TCreateInput
        item: TOutput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'create'
        status: 'rolled-back'
        inputData: TCreateInput
        error: unknown
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        status: 'committed'
        inputData: TUpdateInput
        originalItem: TOutput
        item: TOutput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'update'
        status: 'rolled-back'
        inputData: TUpdateInput
        originalItem: TOutput | undefined
        error: unknown
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        status: 'committed'
        originalItem: TOutput
        context: AccessContext
      }
    | {
        listKey: string
        operation: 'delete'
        status: 'rolled-back'
        originalItem: TOutput | undefined
        error: unknown
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.afterTransaction) {
    return
  }
  await hooks.afterTransaction(args as Parameters<typeof hooks.afterTransaction>[0])
}

/**
 * Execute field-level beforeTransaction hooks (#590 / ADR-0010).
 *
 * Runs each field's `beforeTransaction` (side effects only). Like the list-level
 * hook, these run OUTSIDE the transaction before it opens; a throw aborts the
 * write. For create/update the field is only invoked when it appears in
 * `inputData` (mirroring the field beforeOperation gate); for delete all fields
 * with the hook run against the existing `item`.
 */
export async function executeFieldBeforeTransactionHooks(
  inputData: Record<string, unknown> | undefined,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  item?: Record<string, unknown>,
): Promise<void> {
  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    if (!fieldConfig.hooks?.beforeTransaction) continue
    if (operation !== 'delete' && !(inputData && fieldKey in inputData)) continue

    if (operation === 'delete') {
      await fieldConfig.hooks.beforeTransaction({
        listKey,
        fieldKey,
        operation: 'delete',
        item,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeTransaction>[0])
    } else if (operation === 'create') {
      await fieldConfig.hooks.beforeTransaction({
        listKey,
        fieldKey,
        operation: 'create',
        inputData,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeTransaction>[0])
    } else {
      await fieldConfig.hooks.beforeTransaction({
        listKey,
        fieldKey,
        operation: 'update',
        inputData,
        item,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeTransaction>[0])
    }
  }
}

/**
 * Outcome of a settled write transaction, passed to afterTransaction hooks.
 *
 *  - `committed`: the write persisted; the persisted `item` (and, for
 *    update/delete, `originalItem`) is available.
 *  - `rolled-back`: the write was aborted/rolled back; NO persisted `item` —
 *    only `inputData`/`originalItem` and the `error` that caused the rollback,
 *    so hooks can compensate.
 */
export type TransactionOutcome =
  | { status: 'committed'; item: Record<string, unknown> }
  | { status: 'rolled-back'; error: unknown }

/**
 * Execute field-level afterTransaction hooks (#590 / ADR-0010).
 *
 * Runs each field's `afterTransaction` (side effects only) with the settled
 * transaction outcome. On commit the field receives the persisted `item`/
 * `originalItem` — but ONLY for the top-level list (`isTopLevel`); for nested
 * lists they are `undefined`, since `outcome.item` is the top-level persisted
 * row and handing it to a nested field's hook would be unsound. On rollback the
 * field receives the `error` and NO `item`. Unlike the field `afterOperation`
 * gate, EVERY field with the hook runs (compensation must not depend on the
 * field appearing in the payload).
 */
export async function executeFieldAfterTransactionHooks(
  outcome: TransactionOutcome,
  inputData: Record<string, unknown> | undefined,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  isTopLevel: boolean,
  originalItem?: Record<string, unknown>,
): Promise<void> {
  // The persisted/pre-write rows are surfaced only for the top-level list.
  const committedItem = outcome.status === 'committed' && isTopLevel ? outcome.item : undefined
  const committedOriginalItem = isTopLevel ? originalItem : undefined

  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    if (!fieldConfig.hooks?.afterTransaction) continue

    const base = { listKey, fieldKey, context }

    if (outcome.status === 'rolled-back') {
      if (operation === 'delete') {
        await fieldConfig.hooks.afterTransaction({
          ...base,
          operation: 'delete',
          status: 'rolled-back',
          originalItem,
          error: outcome.error,
        } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
      } else if (operation === 'create') {
        await fieldConfig.hooks.afterTransaction({
          ...base,
          operation: 'create',
          status: 'rolled-back',
          inputData,
          error: outcome.error,
        } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
      } else {
        await fieldConfig.hooks.afterTransaction({
          ...base,
          operation: 'update',
          status: 'rolled-back',
          inputData,
          originalItem,
          error: outcome.error,
        } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
      }
      continue
    }

    // committed
    if (operation === 'delete') {
      await fieldConfig.hooks.afterTransaction({
        ...base,
        operation: 'delete',
        status: 'committed',
        originalItem: committedOriginalItem,
      } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
    } else if (operation === 'create') {
      await fieldConfig.hooks.afterTransaction({
        ...base,
        operation: 'create',
        status: 'committed',
        inputData,
        item: committedItem,
      } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
    } else {
      await fieldConfig.hooks.afterTransaction({
        ...base,
        operation: 'update',
        status: 'committed',
        inputData,
        originalItem: committedOriginalItem,
        item: committedItem,
      } as Parameters<typeof fieldConfig.hooks.afterTransaction>[0])
    }
  }
}

/**
 * Execute field-level resolveInput hooks
 * Allows fields to transform their input values before database write
 */
export async function executeFieldResolveInputHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedData: Record<string, any>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<Record<string, unknown>> {
  let result = { ...resolvedData }

  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    // Skip if field not in data
    if (!(fieldKey in result)) continue

    // A field's resolveInput produces its resolved value; for most fields that
    // value is stored back under the same key. Multi-column fields additionally
    // split that value across their physical columns below.
    let resolvedValue: unknown = result[fieldKey]

    if (fieldConfig.hooks?.resolveInput) {
      // Execute field hook
      // Type assertion is safe here because hooks are typed correctly in field definitions
      // and we're working with runtime values that match those types
      resolvedValue = await fieldConfig.hooks.resolveInput({
        listKey,
        fieldKey,
        operation,
        inputData,
        item,
        resolvedData: { ...result }, // Pass a copy to avoid mutation affecting recorded args
        context,
      } as Parameters<typeof fieldConfig.hooks.resolveInput>[0])
    } else if (!fieldConfig.splitColumns) {
      // No resolveInput and not a multi-column field — nothing to do.
      continue
    }

    if (fieldConfig.splitColumns) {
      // Multi-column field (e.g. storage image()/file() in Keystone-parity
      // mode): replace the single logical key with its per-part columns so the
      // write payload targets the live columns instead of a single one.
      //
      // The split removes the logical key from the payload BEFORE the
      // canonical writable-field filter (`filterWritableFields`) runs, and the
      // raw per-part column keys are not in `fieldConfigs` — so that later
      // filter cannot enforce this field's own write access. Enforce it HERE,
      // using the canonical field-access evaluator with the SAME arguments the
      // write pipeline uses. A single-column field denied by `update`/`create`
      // is simply omitted from the write; a denied multi-column field must
      // likewise contribute NONE of its per-part columns. (sudo bypasses via
      // `checkFieldAccess`.)
      const canWrite = await checkFieldAccess(fieldConfig.access, operation, {
        session: context.session,
        item,
        context,
        inputData,
      })
      if (!canWrite) {
        // Denied: drop the logical key and write none of its columns — exactly
        // as filterWritableFields drops a denied single-column field.
        const next = { ...result }
        delete next[fieldKey]
        result = next
        continue
      }
      const columns = fieldConfig.splitColumns(fieldKey, resolvedValue)
      // Drop the logical key (it is not a real column) and merge the columns.
      const next = { ...result, ...columns }
      delete next[fieldKey]
      result = next
    } else {
      // Create new object with updated field to avoid mutating the passed reference
      result = { ...result, [fieldKey]: resolvedValue }
    }
  }

  return result
}

/**
 * Execute field-level validate hooks
 * Allows fields to perform custom validation after resolveInput but before database write
 */
export async function executeFieldValidateHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputData: Record<string, any> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedData: Record<string, any> | undefined,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<void> {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}

  const addValidationError = (fieldKey: string) => (msg: string) => {
    errors.push(msg)
    fieldErrors[fieldKey] = msg
  }

  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    // Support both 'validate' (new) and 'validateInput' (deprecated) for backwards compatibility
    const validateHook = fieldConfig.hooks?.validate ?? fieldConfig.hooks?.validateInput
    if (!validateHook) continue

    // Execute field hook
    // Type assertion is safe here because hooks are typed correctly in field definitions
    if (operation === 'delete') {
      await validateHook({
        listKey,
        fieldKey,
        operation: 'delete',
        item,
        context,
        addValidationError: addValidationError(fieldKey),
      } as Parameters<typeof validateHook>[0])
    } else if (operation === 'create') {
      await validateHook({
        listKey,
        fieldKey,
        operation: 'create',
        inputData,
        item: undefined,
        resolvedData,
        context,
        addValidationError: addValidationError(fieldKey),
      } as Parameters<typeof validateHook>[0])
    } else {
      // operation === 'update'
      await validateHook({
        listKey,
        fieldKey,
        operation: 'update',
        inputData,
        item,
        resolvedData,
        context,
        addValidationError: addValidationError(fieldKey),
      } as Parameters<typeof validateHook>[0])
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors, fieldErrors)
  }
}

/**
 * Execute field-level beforeOperation hooks (side effects only)
 * Allows fields to perform side effects before database write
 */
export async function executeFieldBeforeOperationHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedData: Record<string, any>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<void> {
  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    // Skip if no hooks defined
    if (!fieldConfig.hooks?.beforeOperation) continue
    // Skip if field not in data (for create/update)
    if (operation !== 'delete' && !(fieldKey in resolvedData)) continue

    // Execute field hook (side effects only, no return value used)
    // Type assertion is safe here because hooks are typed correctly in field definitions
    if (operation === 'delete') {
      await fieldConfig.hooks.beforeOperation({
        listKey,
        fieldKey,
        operation: 'delete',
        item,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeOperation>[0])
    } else if (operation === 'create') {
      await fieldConfig.hooks.beforeOperation({
        listKey,
        fieldKey,
        operation: 'create',
        inputData,
        resolvedData,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeOperation>[0])
    } else {
      // operation === 'update'
      await fieldConfig.hooks.beforeOperation({
        listKey,
        fieldKey,
        operation: 'update',
        inputData,
        item,
        resolvedData,
        context,
      } as Parameters<typeof fieldConfig.hooks.beforeOperation>[0])
    }
  }
}

/**
 * Execute field-level afterOperation hooks (side effects only)
 * Allows fields to perform side effects after database operations
 */
export async function executeFieldAfterOperationHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  inputData: Record<string, unknown> | undefined,
  resolvedData: Record<string, unknown> | undefined,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalItem?: any,
): Promise<void> {
  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    // Skip if no hooks defined
    if (!fieldConfig.hooks?.afterOperation) continue

    // Execute field hook (side effects only, no return value used)
    if (operation === 'delete') {
      await fieldConfig.hooks.afterOperation({
        listKey,
        fieldKey,
        operation: 'delete',
        originalItem,
        context,
      } as Parameters<typeof fieldConfig.hooks.afterOperation>[0])
    } else if (operation === 'create') {
      await fieldConfig.hooks.afterOperation({
        listKey,
        fieldKey,
        operation: 'create',
        inputData,
        item,
        resolvedData,
        context,
      } as Parameters<typeof fieldConfig.hooks.afterOperation>[0])
    } else {
      // operation === 'update'
      await fieldConfig.hooks.afterOperation({
        listKey,
        fieldKey,
        operation: 'update',
        inputData,
        originalItem,
        item,
        resolvedData,
        context,
      } as Parameters<typeof fieldConfig.hooks.afterOperation>[0])
    }
  }
}

/**
 * Validate field-level validation rules using Zod
 * Checks isRequired, length constraints, etc.
 */
export function validateFieldRules(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  operation: 'create' | 'update' = 'create',
): { errors: string[]; fieldErrors: Record<string, string> } {
  const result = validateWithZod(data, fieldConfigs, operation)

  if (result.success) {
    return { errors: [], fieldErrors: {} }
  }

  // Convert field errors to array of error messages
  const errors = Object.entries(result.errors).map(([_field, message]) => message)

  return { errors, fieldErrors: result.errors }
}
