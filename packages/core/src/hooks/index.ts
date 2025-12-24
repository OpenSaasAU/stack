import type { Hooks } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'
import { validateWithZod } from '../validation/schema.js'

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
        operation: 'create'
        resolvedData: TCreateInput
        item: undefined
        context: AccessContext
      }
    | {
        operation: 'update'
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
 * Execute validateInput hook
 * Allows custom validation logic
 */
export async function executeValidateInput<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
>(
  hooks: Hooks<TOutput, TCreateInput, TUpdateInput> | undefined,
  args:
    | {
        operation: 'create'
        resolvedData: TCreateInput
        item: undefined
        context: AccessContext
      }
    | {
        operation: 'update'
        resolvedData: TUpdateInput
        item: TOutput
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.validateInput) {
    return
  }

  const errors: string[] = []

  const addValidationError = (msg: string) => {
    errors.push(msg)
  }

  await hooks.validateInput({
    ...args,
    addValidationError,
  })

  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
}

/**
 * Execute beforeOperation hook
 * Runs before database operation (cannot modify data)
 */
export async function executeBeforeOperation<TOutput = Record<string, unknown>>(
  hooks: Hooks<TOutput> | undefined,
  args:
    | {
        operation: 'create'
        context: AccessContext
      }
    | {
        operation: 'update' | 'delete'
        item: TOutput
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.beforeOperation) {
    return
  }

  await hooks.beforeOperation(args)
}

/**
 * Execute afterOperation hook
 * Runs after database operation
 */
export async function executeAfterOperation<TOutput = Record<string, unknown>>(
  hooks: Hooks<TOutput> | undefined,
  args:
    | {
        operation: 'create'
        item: TOutput
        originalItem: undefined
        context: AccessContext
      }
    | {
        operation: 'update' | 'delete'
        item: TOutput
        originalItem: TOutput
        context: AccessContext
      },
): Promise<void> {
  if (!hooks?.afterOperation) {
    return
  }

  await hooks.afterOperation(args)
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
