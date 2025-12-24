import { z } from 'zod'
import type {
  TextField,
  IntegerField,
  DecimalField,
  CheckboxField,
  TimestampField,
  CalendarDayField,
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
    getPrismaType: (_fieldName: string) => {
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

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
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
    getPrismaType: (_fieldName: string) => {
      const isRequired = options?.validation?.isRequired
      let modifiers = ''

      // Optional modifier
      if (!isRequired) {
        modifiers += '?'
      }

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
      }

      return {
        type: 'Int',
        modifiers: modifiers || undefined,
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
 * Decimal field for precise numeric values (e.g., currency, measurements)
 *
 * **Features:**
 * - Stores decimal numbers with configurable precision and scale
 * - Uses Prisma's Decimal type (backed by decimal.js for precision)
 * - Default precision: 18 digits, scale: 4 decimal places
 * - Validation for min/max values
 * - Optional database column mapping and nullability control
 * - Index support (boolean or 'unique')
 *
 * **Usage Example:**
 * ```typescript
 * // In opensaas.config.ts
 * fields: {
 *   price: decimal({
 *     precision: 10,
 *     scale: 2,
 *     validation: {
 *       isRequired: true,
 *       min: '0',
 *       max: '999999.99'
 *     }
 *   }),
 *   coordinates: decimal({
 *     precision: 18,
 *     scale: 8,
 *     db: { map: 'coord_value' }
 *   })
 * }
 *
 * // Creating with decimal values
 * const product = await context.db.product.create({
 *   data: {
 *     price: '19.99', // Can use string
 *     // price: 19.99,  // or number (converted to Decimal)
 *   }
 * })
 * ```
 *
 * @param options - Field configuration options
 * @returns Decimal field configuration
 */
export function decimal<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<DecimalField<TTypeInfo>, 'type'>): DecimalField<TTypeInfo> {
  const precision = options?.precision ?? 18
  const scale = options?.scale ?? 4

  return {
    type: 'decimal',
    precision,
    scale,
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      // Decimal values can be provided as strings or numbers
      // Prisma will convert them to Decimal instances
      const baseSchema = z.union(
        [
          z.string({
            message: `${formatFieldName(fieldName)} must be a decimal value (string or number)`,
          }),
          z.number({
            message: `${formatFieldName(fieldName)} must be a decimal value (string or number)`,
          }),
        ],
        {
          message: `${formatFieldName(fieldName)} must be a decimal value`,
        },
      )

      let schema = baseSchema

      // Add min validation if specified
      if (options?.validation?.min !== undefined) {
        const minValue = parseFloat(options.validation.min)
        schema = schema.refine(
          (val) => {
            const numVal = typeof val === 'string' ? parseFloat(val) : val
            return !isNaN(numVal) && numVal >= minValue
          },
          {
            message: `${formatFieldName(fieldName)} must be at least ${options.validation.min}`,
          },
        )
      }

      // Add max validation if specified
      if (options?.validation?.max !== undefined) {
        const maxValue = parseFloat(options.validation.max)
        schema = schema.refine(
          (val) => {
            const numVal = typeof val === 'string' ? parseFloat(val) : val
            return !isNaN(numVal) && numVal <= maxValue
          },
          {
            message: `${formatFieldName(fieldName)} must be at most ${options.validation.max}`,
          },
        )
      }

      return !options?.validation?.isRequired || operation === 'update'
        ? schema.optional().nullable()
        : schema
    },
    getPrismaType: (_fieldName: string) => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired

      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Precision and scale
      modifiers += ` @db.Decimal(${precision}, ${scale})`

      // Default value if provided
      if (options?.defaultValue !== undefined) {
        modifiers += ` @default(${options.defaultValue})`
      }

      // Database mapping
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique/index modifiers
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      } else if (options?.isIndexed === true) {
        modifiers += ' @index'
      }

      return {
        type: 'Decimal',
        modifiers: modifiers.trimStart() || undefined,
      }
    },
    getTypeScriptType: () => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired

      return {
        type: "import('decimal.js').Decimal",
        optional: isNullable,
      }
    },
    getTypeScriptImports: () => {
      return [
        {
          names: ['Decimal'],
          from: 'decimal.js',
          typeOnly: true,
        },
      ]
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
    getPrismaType: (_fieldName: string) => {
      const hasDefault = options?.defaultValue !== undefined
      let modifiers = ''

      if (hasDefault) {
        modifiers = ` @default(${options.defaultValue})`
      }

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
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
    getPrismaType: (_fieldName: string) => {
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

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
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
 * Calendar Day field - date only (no time) in ISO8601 format
 *
 * **Features:**
 * - Stores date values only (no time component)
 * - PostgreSQL/MySQL: Uses native DATE type via @db.Date
 * - SQLite: Uses String representation
 * - Accepts ISO8601 date strings (YYYY-MM-DD format)
 * - Optional validation for required fields
 * - Database column mapping and nullability control
 * - Index support (boolean or 'unique')
 *
 * **Usage Example:**
 * ```typescript
 * // In opensaas.config.ts
 * fields: {
 *   birthDate: calendarDay({
 *     validation: { isRequired: true }
 *   }),
 *   startDate: calendarDay({
 *     defaultValue: '2025-01-01',
 *     db: { map: 'start_date' }
 *   }),
 *   endDate: calendarDay({
 *     isIndexed: true
 *   })
 * }
 *
 * // Creating with date values
 * const event = await context.db.event.create({
 *   data: {
 *     startDate: '2025-01-15',
 *     endDate: '2025-01-20'
 *   }
 * })
 * ```
 *
 * @param options - Field configuration options
 * @returns Calendar Day field configuration
 */
export function calendarDay<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<CalendarDayField<TTypeInfo>, 'type'>): CalendarDayField<TTypeInfo> {
  return {
    type: 'calendarDay',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      // Accept ISO8601 date strings (YYYY-MM-DD)
      const baseSchema = z.string({
        message: `${formatFieldName(fieldName)} must be a valid date in ISO8601 format (YYYY-MM-DD)`,
      })

      // Validate ISO8601 date format (YYYY-MM-DD)
      const dateSchema = baseSchema.regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: `${formatFieldName(fieldName)} must be in YYYY-MM-DD format`,
      })

      if (isRequired && operation === 'create') {
        return dateSchema
      } else if (isRequired && operation === 'update') {
        // Required in update mode: can be undefined for partial updates
        return z.union([dateSchema, z.undefined()])
      } else {
        return dateSchema.optional().nullable()
      }
    },
    getPrismaType: (_fieldName: string, provider?: string) => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired

      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Add @db.Date attribute for date-only storage
      // Only for PostgreSQL/MySQL - SQLite doesn't support native DATE type
      // SQLite will use TEXT for DateTime fields
      if (provider && provider.toLowerCase() !== 'sqlite') {
        modifiers += ' @db.Date'
      }

      // Default value if provided
      if (options?.defaultValue !== undefined) {
        modifiers += ` @default("${options.defaultValue}")`
      }

      // Database mapping
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique/index modifiers
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      } else if (options?.isIndexed === true) {
        modifiers += ' @index'
      }

      return {
        type: 'DateTime',
        modifiers: modifiers.trimStart() || undefined,
      }
    },
    getTypeScriptType: () => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired

      return {
        type: 'Date',
        optional: isNullable,
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
    getPrismaType: (_fieldName: string) => {
      const isRequired = options?.validation?.isRequired
      let modifiers = ''

      // Optional modifier
      if (!isRequired) {
        modifiers += '?'
      }

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers || undefined,
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
    getPrismaType: (_fieldName: string) => {
      const isRequired = options.validation?.isRequired
      let modifiers = ''

      // Required fields don't get the ? modifier
      if (!isRequired) {
        modifiers = '?'
      }

      // Add default value if provided
      if (options.defaultValue !== undefined) {
        modifiers = ` @default("${options.defaultValue}")`
      }

      // Map modifier
      if (options.db?.map) {
        modifiers += ` @map("${options.db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers || undefined,
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

  // Validate ref format: 'ListName.fieldName' or 'ListName'
  const refParts = options.ref.split('.')
  if (refParts.length !== 1 && refParts.length !== 2) {
    throw new Error(
      `Invalid relationship ref format: "${options.ref}". Expected format: "ListName.fieldName" or "ListName"`,
    )
  }

  // Validate db.foreignKey usage
  if (options.db?.foreignKey !== undefined) {
    // Can only be used on single relationships (not many)
    if (options.many) {
      throw new Error(
        'db.foreignKey can only be used on single relationships (many: false or undefined). ' +
          'Many-side of a relationship never stores the foreign key.',
      )
    }

    // Can only be used on bidirectional relationships (with target field)
    if (refParts.length === 1) {
      throw new Error(
        'db.foreignKey can only be used on bidirectional relationships (ref: "ListName.fieldName"). ' +
          'List-only refs (ref: "ListName") always create foreign keys automatically.',
      )
    }
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
    getPrismaType: (_fieldName: string) => {
      const isRequired = options?.validation?.isRequired
      let modifiers = ''

      // Optional modifier
      if (!isRequired) {
        modifiers += '?'
      }

      // Map modifier
      if (options?.db?.map) {
        modifiers += ` @map("${options.db.map}")`
      }

      return {
        type: 'Json',
        modifiers: modifiers || undefined,
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
 * Convert a TypeDescriptor to a TypeScript type string
 * Handles three formats:
 * 1. Primitive string: 'string', 'number', 'boolean' -> returned as-is
 * 2. Import string: "import('decimal.js').Decimal" -> returned as-is
 * 3. Type object: { value: Decimal, from: 'decimal.js' } -> "import('decimal.js').Decimal"
 */
function typeDescriptorToString(descriptor: import('../config/types.js').TypeDescriptor): string {
  if (typeof descriptor === 'string') {
    return descriptor
  }

  // Extract type name from constructor or use provided name
  const typeName = descriptor.name || descriptor.value.name

  // Generate import string
  return `import('${descriptor.from}').${typeName}`
}

/**
 * Extract TypeScript imports from a TypeDescriptor
 * Returns array of import statements needed for type generation
 */
function typeDescriptorToImports(
  descriptor: import('../config/types.js').TypeDescriptor,
): Array<{ names: string[]; from: string; typeOnly?: boolean }> {
  // If it's a string, check if it's an import string
  if (typeof descriptor === 'string') {
    const importMatch = descriptor.match(/import\('([^']+)'\)\.(\w+)/)
    if (importMatch) {
      return [
        {
          names: [importMatch[2]],
          from: importMatch[1],
          typeOnly: true,
        },
      ]
    }
    return []
  }

  // Type object descriptor
  const typeName = descriptor.name || descriptor.value.name
  return [
    {
      names: [typeName],
      from: descriptor.from,
      typeOnly: true,
    },
  ]
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
 * - Supports custom scalar types (e.g., Decimal) for financial precision
 *
 * **Usage Examples:**
 * ```typescript
 * // Read-only computed field with primitive type
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
 * // Custom scalar type using import string
 * fields: {
 *   totalPrice: virtual({
 *     type: "import('decimal.js').Decimal",
 *     hooks: {
 *       resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity)
 *     }
 *   })
 * }
 *
 * // Custom scalar type using type descriptor (recommended)
 * import Decimal from 'decimal.js'
 *
 * fields: {
 *   totalPrice: virtual({
 *     type: { value: Decimal, from: 'decimal.js' },
 *     hooks: {
 *       resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity)
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
 * ```
 *
 * **Requirements:**
 * - Must provide `type` (TypeScript type string, import string, or type descriptor)
 * - Must provide `resolveOutput` hook (for reads)
 * - Optional `resolveInput` hook (for write side effects)
 *
 * @param options - Virtual field configuration
 * @returns Virtual field configuration
 */
export function virtual<TTypeInfo extends import('../config/types.js').TypeInfo>(
  options: Omit<VirtualField<TTypeInfo>, 'virtual' | 'outputType' | 'type'> & {
    type: import('../config/types.js').TypeDescriptor
  },
): VirtualField<TTypeInfo> {
  // Validate that resolveOutput is provided
  if (!options.hooks?.resolveOutput) {
    throw new Error(
      'Virtual fields must provide a resolveOutput hook to compute their value. ' +
        'Example: hooks: { resolveOutput: ({ item }) => computeValue(item) }',
    )
  }

  // Convert type descriptor to string
  const outputType = typeDescriptorToString(options.type)
  const imports = typeDescriptorToImports(options.type)

  const { type: _, ...rest } = options

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
        type: outputType,
        optional: false, // Virtual fields always compute a value
      }
    },
    // Add import statements if needed
    getTypeScriptImports: imports.length > 0 ? () => imports : undefined,
    // Virtual fields never validate input (they don't accept database input)
    getZodSchema: () => {
      return z.never()
    },
  }
}
