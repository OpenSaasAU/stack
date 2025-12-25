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
