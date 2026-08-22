import type { Hooks } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'
import { validateWithZod } from '../validation/schema.js'
import { checkFieldAccess } from '../access/field-access.js'

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

/** Used for Prisma errors like unique constraint violations. */
export class DatabaseError extends Error {
  public fieldErrors: Record<string, string>
  public code?: string
  /** The name of the violated unique constraint, when recoverable (P2002 only). */
  public constraintName?: string

  constructor(
    message: string,
    fieldErrors: Record<string, string> = {},
    code?: string,
    constraintName?: string,
  ) {
    super(message)
    this.name = 'DatabaseError'
    this.fieldErrors = fieldErrors
    this.code = code
    this.constraintName = constraintName
  }
}

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

/** Supports both `validate` and the deprecated `validateInput` alias for backwards compatibility. */
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

/** Side effects only — cannot modify data before the database write. */
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
  { status: 'committed'; item: Record<string, unknown> } | { status: 'rolled-back'; error: unknown }

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
 * NOTE (#789): multi-column fields (e.g. storage image()/file() in
 * Keystone-parity mode) are NOT split here. This phase only resolves each
 * field's value under its LOGICAL key, so that phases 2-3 (list/field
 * `validate` → `validateFieldRules`) run against the same shape a
 * single-column field would present — including an unrecognised/invalid value
 * a field's `resolveInput` chose to pass through for validation to catch. The
 * split into physical columns happens strictly AFTER validation passes; see
 * {@link splitMultiColumnFields}.
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
    if (!(fieldKey in result)) continue
    if (!fieldConfig.hooks?.resolveInput) continue

    // Type assertion is safe here because hooks are typed correctly in field definitions
    // and we're working with runtime values that match those types
    const resolvedValue = await fieldConfig.hooks.resolveInput({
      listKey,
      fieldKey,
      operation,
      inputData,
      item,
      resolvedData: { ...result }, // Pass a copy to avoid mutation affecting recorded args
      context,
    } as Parameters<typeof fieldConfig.hooks.resolveInput>[0])

    // Create new object with updated field to avoid mutating the passed reference
    result = { ...result, [fieldKey]: resolvedValue }
  }

  return result
}

/**
 * Split multi-column fields' resolved LOGICAL values into their physical
 * per-part columns (e.g. storage image()/file() in Keystone-parity mode — see
 * ADR-0006).
 *
 * Runs AFTER `validateFieldRules` has passed (#789): a multi-column field's
 * `getZodSchema` gets a genuine chance to reject an unrecognised/invalid
 * logical value BEFORE it is split into `null`/`undefined` physical columns
 * and silently written. Previously this split ran inline inside
 * `executeFieldResolveInputHooks` (Phase 1.5, BEFORE validation), which let an
 * unrecognised value bypass validation entirely.
 *
 * Preserves the field-level write-access gate exactly as before: the raw
 * per-part column keys are not declared in `fieldConfigs`, so
 * `filterWritableFields`'s undeclared-key reject cannot enforce this field's
 * own write access — enforce it HERE, using the canonical field-access
 * evaluator with the same arguments the write pipeline uses. A denied field
 * drops its logical key and contributes NONE of its per-part columns (sudo
 * bypasses via `checkFieldAccess`).
 */
export async function splitMultiColumnFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedData: Record<string, any>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
  context: AccessContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<Record<string, unknown>> {
  let result = { ...resolvedData }

  for (const [fieldKey, fieldConfig] of Object.entries(fields)) {
    if (!fieldConfig.splitColumns) continue
    if (!(fieldKey in result)) continue

    const resolvedValue = result[fieldKey]

    const canWrite = await checkFieldAccess(fieldConfig.access, operation, {
      session: context.session,
      item,
      context,
      inputData,
    })

    // Drop the logical key (it is not a real column) regardless of outcome —
    // a denied field must not leave its logical key behind either.
    const next = { ...result }
    delete next[fieldKey]
    result = next

    if (!canWrite) {
      // Denied: write none of its per-part columns — exactly as
      // filterWritableFields drops a denied single-column field.
      continue
    }

    const columns = fieldConfig.splitColumns(fieldKey, resolvedValue)
    result = { ...result, ...columns }
  }

  return result
}

/** Runs after resolveInput and before the database write. */
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
    // validate / deprecated validateInput fallback — see executeValidate
    const validateHook = fieldConfig.hooks?.validate ?? fieldConfig.hooks?.validateInput
    if (!validateHook) continue

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
    if (!fieldConfig.hooks?.beforeOperation) continue
    if (operation !== 'delete' && !(fieldKey in resolvedData)) continue

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
    if (!fieldConfig.hooks?.afterOperation) continue

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

export function validateFieldRules(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  operation: 'create' | 'update' = 'create',
): { errors: string[]; fieldErrors: Record<string, string> } {
  const result = validateWithZod(data, fieldConfigs, operation)

  if (result.success) {
    return { errors: [], fieldErrors: {} }
  }

  const errors = Object.entries(result.errors).map(([_field, message]) => message)

  return { errors, fieldErrors: result.errors }
}
