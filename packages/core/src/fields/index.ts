import { z } from 'zod'
import type {
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
  JsonField,
  VirtualField,
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
export function text<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<TextField<TTypeInfo>, 'type'>): TextField<TTypeInfo> {
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

      return !isRequired ? withMax.optional().nullable() : withMax
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
export function integer<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<IntegerField<TTypeInfo>, 'type'>): IntegerField<TTypeInfo> {
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
        ? withMax.optional().nullable()
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
export function checkbox<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<CheckboxField<TTypeInfo>, 'type'>): CheckboxField<TTypeInfo> {
  return {
    type: 'checkbox',
    ...options,
    getZodSchema: () => {
      return z.boolean().optional().nullable()
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
export function timestamp<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<TimestampField<TTypeInfo>, 'type'>): TimestampField<TTypeInfo> {
  return {
    type: 'timestamp',
    ...options,
    getZodSchema: () => {
      return z.union([z.date(), z.iso.datetime()]).optional().nullable()
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
 * - Uses field-level hooks (`resolveInput` and `resolveOutput`) for automatic transformations
 * - The hashing happens via `hooks.resolveInput` during create/update operations
 * - The wrapping happens via `hooks.resolveOutput` during read operations
 * - This pattern allows third-party field types to define their own transformations
 *
 * @param options - Field configuration options
 * @returns Password field configuration
 */
export function password<TTypeInfo extends import('../config/types.js').TypeInfo>(
  options?: Omit<PasswordField<TTypeInfo>, 'type'>,
): PasswordField<TTypeInfo> {
  return {
    type: 'password',
    ...options,
    resultExtension: {
      outputType: "import('@opensaas/stack-core').HashedPassword",
      // No compute - delegates to resolveOutput hook
    },
    ui: {
      ...options?.ui,
      valueForClientSerialization: ({ value }) => ({ isSet: !!value }),
    },
    // Cast hooks to any since field builders are generic and can't know the specific TFieldKey
    hooks: {
      // Hash password before writing to database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveInput: async ({ inputValue }: { inputValue: any }) => {
        // Skip if undefined or null (allows partial updates)
        if (inputValue === undefined || inputValue === null) {
          return inputValue
        }

        // Skip if not a string
        if (typeof inputValue !== 'string' || inputValue.length === 0) {
          return inputValue
        }

        // Skip if already hashed (idempotent)
        if (isHashedPassword(inputValue)) {
          return inputValue
        }

        // Hash the password
        return await hashPassword(inputValue)
      },
      // Wrap password with HashedPassword class after reading from database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveOutput: ({ value }: { value: any }) => {
        // Only wrap string values (hashed passwords)
        if (typeof value === 'string' && value.length > 0) {
          return new HashedPassword(value)
        }
        return undefined
      },
      // Merge with user-provided hooks if any
      ...options?.hooks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hook object needs type assertion for field builder
    } as any,
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
          .nullable()
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
export function select<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options: Omit<SelectField<TTypeInfo>, 'type'>): SelectField<TTypeInfo> {
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
        schema = schema.optional().nullable()
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
export function relationship<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options: Omit<RelationshipField<TTypeInfo>, 'type'>): RelationshipField<TTypeInfo> {
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

/**
 * JSON field for storing arbitrary JSON data
 *
 * **Features:**
 * - Stores any valid JSON data (objects, arrays, primitives)
 * - Stored as JSON type in database (PostgreSQL/MySQL) or TEXT in SQLite
 * - Optional validation for required fields
 * - UI options for formatting and display
 *
 * **Usage Example:**
 * ```typescript
 * // In opensaas.config.ts
 * fields: {
 *   metadata: json({
 *     validation: { isRequired: false },
 *     ui: {
 *       placeholder: 'Enter JSON data...',
 *       rows: 10,
 *       formatted: true
 *     }
 *   }),
 *   settings: json({
 *     validation: { isRequired: true }
 *   })
 * }
 *
 * // Creating with JSON data
 * const item = await context.db.item.create({
 *   data: {
 *     metadata: { key: 'value', nested: { data: [1, 2, 3] } }
 *   }
 * })
 *
 * // Querying returns parsed JSON
 * const item = await context.db.item.findUnique({
 *   where: { id: '...' }
 * })
 * console.log(item.metadata.key) // 'value'
 * ```
 *
 * @param options - Field configuration options
 * @returns JSON field configuration
 */
export function json<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<JsonField<TTypeInfo>, 'type'>): JsonField<TTypeInfo> {
  return {
    type: 'json',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      // Accept any valid JSON value
      const baseSchema = z.unknown()

      if (isRequired && operation === 'create') {
        // Required in create mode: value must be provided
        return baseSchema
      } else if (isRequired && operation === 'update') {
        // Required in update mode: can be undefined for partial updates
        return z.union([baseSchema, z.undefined()])
      } else {
        // Not required: can be undefined or null
        return baseSchema.optional().nullable()
      }
    },
    getPrismaType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'Json',
        modifiers: isRequired ? undefined : '?',
      }
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'unknown',
        optional: !isRequired,
      }
    },
  }
}

/**
 * Virtual field - not stored in database, computed via hooks
 *
 * **Features:**
 * - Does not create a column in the database
 * - Uses resolveOutput hook to compute value from other fields
 * - Optionally uses resolveInput hook for write side effects (e.g., sync to external API)
 * - Only computed when explicitly selected/included in queries
 * - Supports both read and write operations via hooks
 *
 * **Usage Example:**
 * ```typescript
 * // Read-only computed field
 * fields: {
 *   firstName: text(),
 *   lastName: text(),
 *   fullName: virtual({
 *     type: 'string',
 *     hooks: {
 *       resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`
 *     }
 *   })
 * }
 *
 * // Write side effects (e.g., sync to external API)
 * fields: {
 *   externalSync: virtual({
 *     type: 'boolean',
 *     hooks: {
 *       resolveInput: async ({ item }) => {
 *         await syncToExternalAPI(item)
 *         return undefined // Don't store anything
 *       },
 *       resolveOutput: () => true
 *     }
 *   })
 * }
 *
 * // Query with select
 * const user = await context.db.user.findUnique({
 *   where: { id },
 *   select: { firstName: true, lastName: true, fullName: true } // fullName computed
 * })
 * ```
 *
 * **Requirements:**
 * - Must provide `type` (TypeScript type string)
 * - Must provide `resolveOutput` hook (for reads)
 * - Optional `resolveInput` hook (for write side effects)
 *
 * @param options - Virtual field configuration
 * @returns Virtual field configuration
 */
export function virtual<TTypeInfo extends import('../config/types.js').TypeInfo>(
  options: Omit<VirtualField<TTypeInfo>, 'virtual' | 'outputType' | 'type'> & { type: string },
): VirtualField<TTypeInfo> {
  // Validate that resolveOutput is provided
  if (!options.hooks?.resolveOutput) {
    throw new Error(
      'Virtual fields must provide a resolveOutput hook to compute their value. ' +
        'Example: hooks: { resolveOutput: ({ item }) => computeValue(item) }',
    )
  }

  const { type: outputType, ...rest } = options

  return {
    type: 'virtual',
    virtual: true,
    outputType,
    ...rest,
    // Virtual fields don't create database columns
    // Return undefined to signal generator to skip this field
    getPrismaType: undefined,
    // Virtual fields appear in output types with their specified type
    getTypeScriptType: () => {
      return {
        type: options.type,
        optional: false, // Virtual fields always compute a value
      }
    },
    // Virtual fields never validate input (they don't accept database input)
    getZodSchema: () => {
      return z.never()
    },
  }
}
