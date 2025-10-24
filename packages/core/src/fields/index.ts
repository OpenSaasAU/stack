import { z } from 'zod'
import type {
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
} from '../config/types.js'
import { hashPassword, isHashedPassword, HashedPassword } from '../utils/password.js'

/**
 * Format field name for display in error messages
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/**
 * Text field
 */
export function text(options?: Omit<TextField, 'type'>): TextField {
  return {
    type: 'text',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired
      const length = validation?.length
      const minLength = length?.min && length.min > 0 ? length.min : 1

      const baseSchema = z.string({
        message: `${formatFieldName(fieldName)} must be text`,
      })

      const withMin =
        isRequired || length?.min !== undefined
          ? baseSchema.min(minLength, {
              message:
                minLength > 1
                  ? `${formatFieldName(fieldName)} must be at least ${minLength} characters`
                  : `${formatFieldName(fieldName)} is required`,
            })
          : baseSchema

      const withMax =
        length?.max !== undefined
          ? withMin.max(length.max, {
              message: `${formatFieldName(fieldName)} must be at most ${length.max} characters`,
            })
          : withMin

      if (isRequired && operation === 'update') {
        return z.union([withMax, z.undefined()])
      }

      return !isRequired ? withMax.optional() : withMax
    },
    getPrismaType: () => {
      const validation = options?.validation
      const isRequired = validation?.isRequired
      let modifiers = ''

      // Optional modifier
      if (!isRequired) {
        modifiers += '?'
      }

      // Unique/index modifiers
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      } else if (options?.isIndexed === true) {
        modifiers += ' @index'
      }

      return {
        type: 'String',
        modifiers: modifiers || undefined,
      }
    },
    getTypeScriptType: () => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      return {
        type: 'string',
        optional: !isRequired,
      }
    },
  }
}

/**
 * Integer field
 */
export function integer(options?: Omit<IntegerField, 'type'>): IntegerField {
  return {
    type: 'integer',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const baseSchema = z.number({
        message: `${formatFieldName(fieldName)} must be a number`,
      })

      const withMin =
        options?.validation?.min !== undefined
          ? baseSchema.min(options.validation.min, {
              message: `${formatFieldName(fieldName)} must be at least ${options.validation.min}`,
            })
          : baseSchema

      const withMax =
        options?.validation?.max !== undefined
          ? withMin.max(options.validation.max, {
              message: `${formatFieldName(fieldName)} must be at most ${options.validation.max}`,
            })
          : withMin

      return !options?.validation?.isRequired || operation === 'update'
        ? withMax.optional()
        : withMax
    },
    getPrismaType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'Int',
        modifiers: isRequired ? undefined : '?',
      }
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'number',
        optional: !isRequired,
      }
    },
  }
}

/**
 * Checkbox (boolean) field
 */
export function checkbox(options?: Omit<CheckboxField, 'type'>): CheckboxField {
  return {
    type: 'checkbox',
    ...options,
    getZodSchema: () => {
      return z.boolean().optional()
    },
    getPrismaType: () => {
      const hasDefault = options?.defaultValue !== undefined
      let modifiers = ''

      if (hasDefault) {
        modifiers = ` @default(${options.defaultValue})`
      }

      return {
        type: 'Boolean',
        modifiers: modifiers || undefined,
      }
    },
    getTypeScriptType: () => {
      return {
        type: 'boolean',
        optional: options?.defaultValue === undefined,
      }
    },
  }
}

/**
 * Timestamp (DateTime) field
 */
export function timestamp(options?: Omit<TimestampField, 'type'>): TimestampField {
  return {
    type: 'timestamp',
    ...options,
    getZodSchema: () => {
      return z.union([z.date(), z.iso.datetime()]).optional()
    },
    getPrismaType: () => {
      let modifiers = '?'

      // Check for default value
      if (
        options?.defaultValue &&
        typeof options.defaultValue === 'object' &&
        'kind' in options.defaultValue &&
        options.defaultValue.kind === 'now'
      ) {
        modifiers = ' @default(now())'
      }

      return {
        type: 'DateTime',
        modifiers,
      }
    },
    getTypeScriptType: () => {
      const hasDefault =
        options?.defaultValue &&
        typeof options.defaultValue === 'object' &&
        'kind' in options.defaultValue &&
        options.defaultValue.kind === 'now'

      return {
        type: 'Date',
        optional: !hasDefault,
      }
    },
  }
}

/**
 * Password field (automatically hashed using bcrypt)
 *
 * **Security Features:**
 * - Passwords are automatically hashed during create/update operations
 * - Uses bcrypt with cost factor 10 (good balance of security and performance)
 * - Already-hashed passwords are not re-hashed (idempotent)
 * - Password values in query results include a `compare()` method for authentication
 *
 * **Usage Example:**
 * ```typescript
 * // In opensaas.config.ts
 * fields: {
 *   password: password({
 *     validation: { isRequired: true }
 *   })
 * }
 *
 * // Creating a user - password is automatically hashed
 * const user = await context.db.user.create({
 *   data: {
 *     email: 'user@example.com',
 *     password: 'plaintextPassword' // Automatically hashed before storage
 *   }
 * })
 *
 * // Authenticating - use the compare() method
 * const user = await context.db.user.findUnique({
 *   where: { email: 'user@example.com' }
 * })
 *
 * if (user && await user.password.compare('plaintextPassword')) {
 *   // Password is correct - login successful
 * }
 * ```
 *
 * **Important Notes:**
 * - Password fields are excluded from read operations by default in access control
 * - Always use the `compare()` method to verify passwords - never compare strings directly
 * - The password field value has type `HashedPassword` which extends string with compare()
 * - Empty strings and undefined values are skipped (not hashed) to allow partial updates
 *
 * **Implementation Details:**
 * - Uses field-level hooks (`beforeOperation` and `afterOperation`) for automatic transformations
 * - The hashing happens via `hooks.beforeOperation` during create/update operations
 * - The wrapping happens via `hooks.afterOperation` during read operations
 * - This pattern allows third-party field types to define their own transformations
 *
 * @param options - Field configuration options
 * @returns Password field configuration
 */
export function password(options?: Omit<PasswordField, 'type'>): PasswordField {
  return {
    type: 'password',
    ...options,
    typePatch: {
      resultType: "import('@opensaas/framework-core').HashedPassword",
      patchScope: 'scalars-only',
    },
    hooks: {
      // Hash password before writing to database
      beforeOperation: async ({ value }) => {
        // Skip if undefined or null (allows partial updates)
        if (value === undefined || value === null) {
          return value
        }

        // Skip if not a string
        if (typeof value !== 'string') {
          return value
        }

        // Skip empty strings (let validation handle this)
        if (value.length === 0) {
          return value
        }

        // Skip if already hashed (idempotent)
        if (isHashedPassword(value)) {
          return value
        }

        // Hash the password
        return await hashPassword(value)
      },
      // Wrap password with HashedPassword class after reading from database
      afterOperation: ({ value }) => {
        // Only wrap string values (hashed passwords)
        if (typeof value === 'string' && value.length > 0) {
          return new HashedPassword(value)
        }
        return value
      },
      // Merge with user-provided hooks if any
      ...options?.hooks,
    },
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      if (isRequired && operation === 'create') {
        // Required in create mode: reject undefined and empty strings
        return z
          .string({
            message: `${formatFieldName(fieldName)} must be text`,
          })
          .min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          })
      } else if (isRequired && operation === 'update') {
        // Required in update mode: if provided, reject empty strings
        return z.union([
          z.string().min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          }),
          z.undefined(),
        ])
      } else {
        // Not required: can be undefined or any string
        return z
          .string({
            message: `${formatFieldName(fieldName)} must be text`,
          })
          .optional()
      }
    },
    getPrismaType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'String',
        modifiers: isRequired ? undefined : '?',
      }
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'string',
        optional: !isRequired,
      }
    },
  }
}

/**
 * Select field (enum-like)
 */
export function select(options: Omit<SelectField, 'type'>): SelectField {
  if (!options.options || options.options.length === 0) {
    throw new Error('Select field must have at least one option')
  }

  return {
    type: 'select',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const values = options.options.map((opt) => opt.value)
      let schema: z.ZodTypeAny = z.enum(values as [string, ...string[]], {
        message: `${formatFieldName(fieldName)} must be one of: ${values.join(', ')}`,
      })

      if (!options.validation?.isRequired || operation === 'update') {
        schema = schema.optional()
      }

      return schema
    },
    getPrismaType: () => {
      let modifiers = '?'

      // Add default value if provided
      if (options.defaultValue !== undefined) {
        modifiers = ` @default("${options.defaultValue}")`
      }

      return {
        type: 'String',
        modifiers,
      }
    },
    getTypeScriptType: () => {
      // Generate union type from options
      const unionType = options.options.map((opt) => `'${opt.value}'`).join(' | ')

      return {
        type: unionType,
        optional: !options.validation?.isRequired || options.defaultValue !== undefined,
      }
    },
  }
}

/**
 * Relationship field
 */
export function relationship(options: Omit<RelationshipField, 'type'>): RelationshipField {
  if (!options.ref) {
    throw new Error('Relationship field must have a ref')
  }

  // Validate ref format: 'ListName.fieldName'
  const refParts = options.ref.split('.')
  if (refParts.length !== 2) {
    throw new Error(
      `Invalid relationship ref format: "${options.ref}". Expected format: "ListName.fieldName"`,
    )
  }

  return {
    type: 'relationship',
    ...options,
  }
}
