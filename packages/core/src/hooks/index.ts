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
 * Execute resolveInput hook
 * Allows modification of input data before validation
 */
export async function executeResolveInput<T = Record<string, unknown>>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: 'create' | 'update'
    resolvedData: Partial<T>
    item?: T
    context: AccessContext
  },
): Promise<Partial<T>> {
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
export async function executeValidateInput<T = Record<string, unknown>>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: 'create' | 'update'
    resolvedData: Partial<T>
    item?: T
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
export async function executeBeforeOperation<T = Record<string, unknown>>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: 'create' | 'update' | 'delete'
    item?: T
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
export async function executeAfterOperation<T = Record<string, unknown>>(
  hooks: Hooks<T> | undefined,
  args: {
    operation: 'create' | 'update' | 'delete'
    item: T
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
