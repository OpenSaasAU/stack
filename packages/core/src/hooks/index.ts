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
