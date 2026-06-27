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
  OpenSaasConfig,
  FieldConfig,
  PrismaRelationResult,
} from '../config/types.js'
import { hashPassword, isHashedPassword, HashedPassword } from '../utils/password.js'
import { formatPrismaDefault } from './format-prisma-default.js'

// Field-config types live here, alongside the builders that produce them.
// (The umbrella `FieldConfig` and authoring `BaseFieldConfig` stay on the root
// and `/extend` entry points respectively.)
export type {
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
  PrismaRelationResult,
  MultiColumnPrismaResult,
} from '../config/types.js'

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
        return withMax.optional()
      }

      return !isRequired ? withMax.optional().nullable() : withMax
    },
    getPrismaType: (
      _fieldName: string,
      _provider?: string,
      _listName?: string,
      keystoneCompat?: boolean,
    ) => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired
      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Native type modifier (e.g., @db.Text)
      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      // Default value. An explicit `defaultValue` always wins. When none is set
      // and Keystone-compat mode is on, a non-null text column gets Keystone's
      // implicit empty-string default. Both go through formatPrismaDefault, so
      // the empty-string literal (`""`) is produced the same way as any other
      // text default. Independent of the nullable `?` modifier above — the
      // default never overwrites nullability.
      const defaultSource =
        options?.defaultValue !== undefined
          ? options.defaultValue
          : keystoneCompat && !isNullable
            ? ''
            : undefined
      const defaultLiteral = formatPrismaDefault(defaultSource, 'text')
      if (defaultLiteral !== undefined) {
        modifiers += ` @default(${defaultLiteral})`
      }

      // Unique/index modifiers
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      } else if (options?.isIndexed === true) {
        modifiers += ' @index'
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers.trimStart() || undefined,
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
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired
      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Native type modifier (e.g., @db.SmallInt, @db.BigInt)
      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      // Default value if provided (bare numeric literal). Independent of the
      // nullable `?` modifier above — the default never overwrites nullability.
      const defaultLiteral = formatPrismaDefault(options?.defaultValue, 'integer')
      if (defaultLiteral !== undefined) {
        modifiers += ` @default(${defaultLiteral})`
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'Int',
        modifiers: modifiers.trimStart() || undefined,
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
      const db = options?.db
      const hasDefault = options?.defaultValue !== undefined
      let modifiers = ''

      // Nullable modifier - checkbox fields are non-nullable by default (must be true or false)
      // Use db.isNullable: true to allow NULL values in the database
      if (db?.isNullable === true) {
        modifiers += '?'
      }

      if (hasDefault) {
        modifiers += ` @default(${options.defaultValue})`
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'Boolean',
        modifiers: modifiers.trimStart() || undefined,
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
      const db = options?.db
      const hasDefaultNow =
        options?.defaultValue &&
        typeof options.defaultValue === 'object' &&
        'kind' in options.defaultValue &&
        options.defaultValue.kind === 'now'

      // Nullability: explicit db.isNullable overrides the default (nullable unless @default(now()))
      const isNullable = db?.isNullable ?? !hasDefaultNow

      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Default value
      if (hasDefaultNow) {
        modifiers += ' @default(now())'
      }

      // Native type modifier (e.g., @db.Timestamptz for PostgreSQL)
      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'DateTime',
        modifiers: modifiers.trimStart() || undefined,
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
 * Mirrors Keystone's `CalendarDay` scalar: the wire format through
 * `context.db.*` is a `YYYY-MM-DD` **string** in both directions (read and
 * write). The field's TypeScript type — entity, `CreateInput`, and
 * `UpdateInput` — is `string`, so passing a `Date` is a compile-time error.
 *
 * **Features:**
 * - Stores date values only (no time component)
 * - PostgreSQL/MySQL: Uses native DATE type via @db.Date
 * - SQLite: Uses String representation
 * - **Writes:** accept only a `YYYY-MM-DD` string; a malformed string or a
 *   `Date` is rejected at runtime by validation (a `ValidationError`). Genuine
 *   compile-time rejection at the `context.db` call site is tracked in #599.
 * - **Reads:** always return a `YYYY-MM-DD` string. Even though the underlying
 *   `@db.Date` column hands Prisma a `Date`, a `resolveOutput` transform
 *   normalises it back to a `YYYY-MM-DD` string so the runtime value matches
 *   the declared `string` type. UTC components are used to avoid timezone
 *   off-by-one errors.
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
 * // Creating with date values — pass YYYY-MM-DD strings (NOT Date objects)
 * const event = await context.db.event.create({
 *   data: {
 *     startDate: '2025-01-15',
 *     endDate: '2025-01-20'
 *   }
 * })
 *
 * // Reading — values come back as YYYY-MM-DD strings
 * const e = await context.db.event.findUnique({ where: { id } })
 * e?.startDate // => '2025-01-15' (a string, not a Date)
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
    // Reads: the underlying @db.Date column hands Prisma a Date (or a TEXT
    // string under the SQLite fallback). Normalise to a YYYY-MM-DD string so the
    // runtime value matches the declared `string` type. UTC components are used
    // so the formatting never drifts a day in non-UTC timezones.
    // Cast hooks to any since field builders are generic and can't know the
    // specific TFieldKey (same pattern as password()).
    hooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveOutput: ({ value }: { value: any }) => formatCalendarDay(value),
      // Merge with user-provided hooks if any
      ...options?.hooks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hook object needs type assertion for field builder
    } as any,
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
        // Required in update mode: omitted keys pass; present values must be valid
        return dateSchema.optional()
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

      // calendarDay is a YYYY-MM-DD string end-to-end (Keystone's CalendarDay
      // scalar). Returning 'string' here makes the entity/read type and the
      // standalone generated CreateInput/UpdateInput types `string`. At the
      // context.db write path a Date is still rejected at runtime by validation
      // (the generated db method `data` type derives from Prisma's `Date | string`
      // input — making it a compile-time error is tracked in #599).
      return {
        type: 'string',
        optional: isNullable,
      }
    },
  }
}

/**
 * Format a stored calendar-day value to a `YYYY-MM-DD` string.
 *
 * Handles the value being a `Date` (Postgres/MySQL `@db.Date`), an already
 * formatted string (SQLite TEXT fallback), or null/undefined. Dates are
 * formatted from their UTC components so the result never drifts a day in
 * non-UTC timezones.
 */
function formatCalendarDay(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return value as null | undefined
  }

  if (value instanceof Date) {
    // toISOString() is UTC; the YYYY-MM-DD prefix is timezone-safe.
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    // SQLite stores DateTime as TEXT. The value may already be YYYY-MM-DD or a
    // full ISO timestamp — take the date-only prefix either way.
    return value.slice(0, 10)
  }

  // Any other shape is unexpected for a @db.Date column; surface it untouched
  // by returning undefined so callers see the field as absent rather than wrong.
  return undefined
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
      outputType: "import('@opensaas/stack-core/internal').HashedPassword",
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
      resolveInput: async ({ inputData, fieldKey }: { inputData: any; fieldKey: string }) => {
        // Skip if undefined or null (allows partial updates)
        const inputValue = inputData[fieldKey]
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
        return (await hashPassword(inputValue)).toString()
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
        // Required in update mode: omitted keys pass; if provided, reject empty strings
        return z
          .string()
          .min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          })
          .optional()
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
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired
      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      // Native type modifier (e.g., @db.Text)
      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers.trimStart() || undefined,
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
 * Valid Prisma enum value pattern: starts with a letter, followed by letters, digits, or underscores
 */
const PRISMA_ENUM_VALUE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * Select field (enum-like)
 */
export function select<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options: Omit<SelectField<TTypeInfo>, 'type'>): SelectField<TTypeInfo> {
  if (!options.options || options.options.length === 0) {
    throw new Error('Select field must have at least one option')
  }

  const isNativeEnum = options.db?.type === 'enum'

  if (isNativeEnum) {
    const invalidValues = options.options
      .map((opt) => opt.value)
      .filter((value) => !PRISMA_ENUM_VALUE_PATTERN.test(value))

    if (invalidValues.length > 0) {
      throw new Error(
        `Enum select field values must be valid Prisma identifiers (letters, numbers, and underscores, starting with a letter). Invalid values: ${invalidValues.join(', ')}`,
      )
    }
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
    getPrismaType: (fieldName: string, _provider?: string, listName?: string) => {
      const isRequired = options.validation?.isRequired
      const hasDefault = options.defaultValue !== undefined
      // Nullability rules (Keystone parity):
      //  - `db.isNullable` is an explicit override and always wins. Setting it
      //    `true` forces the `?` even when a `defaultValue` is present.
      //  - Otherwise a select is nullable only when it is neither required nor
      //    carrying a default: a `defaultValue` makes the column NOT NULL (the
      //    long-standing default behaviour). This mirrors the previous logic
      //    where a present default overwrote the `?`.
      // Nullability and the default are assembled independently with `+=`
      // (mirroring text/integer) so the default never overwrites the `?`.
      const isNullable = options.db?.isNullable ?? (!isRequired && !hasDefault)
      let modifiers = ''

      // Optional modifier
      if (isNullable) {
        modifiers += '?'
      }

      if (isNativeEnum) {
        // Enum type name: explicit `db.enumName` wins, otherwise derive from
        // list name + field name in PascalCase. The same name is used for the
        // generated enum block (via `result.type`) and the column reference.
        const capitalizedField = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
        const derivedEnumName = listName ? `${listName}${capitalizedField}` : capitalizedField
        const enumName = options.db?.enumName ?? derivedEnumName

        // Add default value if provided (no quotes for enum values)
        if (hasDefault) {
          modifiers += ` @default(${options.defaultValue})`
        }

        // Map modifier
        if (options.db?.map) {
          modifiers += ` @map("${options.db.map}")`
        }

        return {
          type: enumName,
          modifiers: modifiers || undefined,
          enumValues: options.options.map((opt) => opt.value),
        }
      }

      // String type (default)

      // Add default value if provided
      if (hasDefault) {
        modifiers += ` @default("${options.defaultValue}")`
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
      // Generate union type from options (same for both string and enum db types)
      const unionType = options.options.map((opt) => `'${opt.value}'`).join(' | ')

      return {
        type: unionType,
        optional: !options.validation?.isRequired || options.defaultValue !== undefined,
      }
    },
  }
}

/**
 * Parse a relationship ref into its target list and optional target field.
 * Supports both 'ListName.fieldName' (bidirectional) and 'ListName' (list-only) formats.
 */
function parseRelationshipRef(ref: string): { list: string; field?: string } {
  const parts = ref.split('.')
  if (parts.length === 1) {
    const list = parts[0]
    if (!list) {
      throw new Error(`Invalid relationship ref: ${ref}`)
    }
    return { list }
  } else if (parts.length === 2) {
    const [list, field] = parts
    if (!list || !field) {
      throw new Error(`Invalid relationship ref: ${ref}`)
    }
    return { list, field }
  } else {
    throw new Error(`Invalid relationship ref: ${ref}`)
  }
}

/**
 * Check if a relationship is one-to-one (bidirectional with both sides having many: false).
 */
function isOneToOneRelationship(
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  if (!targetField) {
    return false
  }

  if (field.many) {
    return false
  }

  const targetListConfig = config.lists[targetList]
  if (!targetListConfig) {
    throw new Error(`Referenced list "${targetList}" not found in config`)
  }

  const targetFieldConfig = targetListConfig.fields[targetField]
  if (!targetFieldConfig) {
    throw new Error(
      `Referenced field "${targetList}.${targetField}" not found. If you want a one-sided relationship, use ref: "${targetList}" instead of ref: "${targetList}.${targetField}"`,
    )
  }
  if (targetFieldConfig.type !== 'relationship') {
    throw new Error(`Referenced field "${targetList}.${targetField}" is not a relationship field`)
  }

  return !(targetFieldConfig as RelationshipField).many
}

/**
 * Determine if this side of a relationship should store the foreign key.
 * For one-to-one relationships, only one side stores the foreign key.
 */
function shouldHaveForeignKey(
  listKey: string,
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  if (!targetField) {
    return true
  }

  if (field.many) {
    return false
  }

  const isOneToOne = isOneToOneRelationship(fieldName, field, config)
  if (!isOneToOne) {
    return true
  }

  const targetListConfig = config.lists[targetList]!
  const targetFieldConfig = targetListConfig.fields[targetField] as RelationshipField

  const thisSideExplicit = field.db?.foreignKey
  const otherSideExplicit = targetFieldConfig.db?.foreignKey

  if (thisSideExplicit === true && otherSideExplicit === true) {
    throw new Error(
      `Invalid one-to-one relationship: both "${listKey}.${fieldName}" and "${targetList}.${targetField}" have db.foreignKey set to true. Only one side can store the foreign key.`,
    )
  }

  if (thisSideExplicit === true) {
    return true
  }

  if (otherSideExplicit === true) {
    return false
  }

  // Default: the alphabetically "smaller" list name gets the foreign key
  const comparison = listKey.localeCompare(targetList)
  if (comparison !== 0) {
    return comparison < 0
  }

  // Self-referential: use field name ordering
  return fieldName.localeCompare(targetField) < 0
}

/**
 * Check whether a many relationship is a true many-to-many (both sides many).
 */
function isManyToMany(
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): boolean {
  if (!field.many) {
    return false
  }

  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)

  // List-only ref with many: true is implicitly many-to-many
  if (!targetField) {
    return true
  }

  const targetFieldConfig = config.lists[targetList]?.fields[targetField]
  if (!targetFieldConfig || targetFieldConfig.type !== 'relationship') {
    return false
  }

  return !!(targetFieldConfig as RelationshipField).many
}

/**
 * Compute the explicit relation name for a bidirectional many-to-many relationship,
 * or `undefined` when Prisma's default naming should be used.
 *
 * Honours per-field `db.relationName` (which must match on both sides) and the
 * global `db.joinTableNaming: 'keystone'` setting, picking a deterministic owner
 * for bidirectional relationships so both sides resolve to the same name.
 */
function computeManyToManyRelationName(
  listKey: string,
  fieldName: string,
  field: RelationshipField,
  config: OpenSaasConfig,
): string | undefined {
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  const joinTableNaming = config.db.joinTableNaming || 'prisma'

  const sourceRelationName = field.db?.relationName
  let targetRelationName: string | undefined
  if (targetField) {
    const targetFieldConfig = config.lists[targetList]?.fields[targetField]
    if (targetFieldConfig?.type === 'relationship') {
      targetRelationName = (targetFieldConfig as RelationshipField).db?.relationName
    }
  }

  if (sourceRelationName && targetRelationName && sourceRelationName !== targetRelationName) {
    throw new Error(
      `Relation name mismatch: ${listKey}.${fieldName} has relationName "${sourceRelationName}" but ${targetList}.${targetField} has "${targetRelationName}". Both sides must use the same relationName.`,
    )
  }

  const explicitRelationName = sourceRelationName || targetRelationName
  if (explicitRelationName) {
    return explicitRelationName
  }

  if (joinTableNaming === 'keystone') {
    if (targetField) {
      // Pick a deterministic owner so both sides agree on the relation name
      const sourceKey = `${listKey}.${fieldName}`
      const targetKey = `${targetList}.${targetField}`
      return sourceKey.localeCompare(targetKey) < 0
        ? `${listKey}_${fieldName}`
        : `${targetList}_${targetField}`
    }
    return `${listKey}_${fieldName}`
  }

  // Default Prisma naming - no explicit relation name needed
  return undefined
}

/**
 * Build the Prisma schema contribution for a relationship field.
 */
function getPrismaRelation(
  field: RelationshipField,
  fieldName: string,
  listKey: string,
  config: OpenSaasConfig,
): PrismaRelationResult {
  const { list: targetList, field: targetField } = parseRelationshipRef(field.ref)
  const paddedName = fieldName.padEnd(12)

  // Synthetic back-relation for list-only refs (Prisma requires an opposite field)
  let backRelation: PrismaRelationResult['backRelation']
  if (!targetField) {
    const syntheticFieldName = `from_${listKey}_${fieldName}`
    const relationName = field.db?.relationName ?? `${listKey}_${fieldName}`
    backRelation = {
      targetList,
      line: `  ${syntheticFieldName.padEnd(12)} ${listKey}[]  @relation("${relationName}")`,
    }
  }

  if (field.many) {
    let relationLine: string

    if (targetField) {
      // Bidirectional many side: use explicit relation name only for true many-to-many
      const m2mName = isManyToMany(fieldName, field, config)
        ? computeManyToManyRelationName(listKey, fieldName, field, config)
        : undefined
      relationLine = m2mName
        ? `  ${paddedName} ${targetList}[]  @relation("${m2mName}")`
        : `  ${paddedName} ${targetList}[]`
    } else {
      // List-only ref many side: always a named relation paired with the synthetic field
      const relationName = field.db?.relationName ?? `${listKey}_${fieldName}`
      relationLine = `  ${paddedName} ${targetList}[]  @relation("${relationName}")`
    }

    if (field.db?.extendPrismaSchema) {
      relationLine = field.db.extendPrismaSchema({ relationLine }).relationLine
    }

    return { modelLines: [relationLine], backRelation }
  }

  // Single relationship
  if (shouldHaveForeignKey(listKey, fieldName, field, config)) {
    const foreignKeyField = `${fieldName}Id`
    const fkPaddedName = foreignKeyField.padEnd(12)

    const uniqueModifier = isOneToOneRelationship(fieldName, field, config) ? ' @unique' : ''

    const mapModifier =
      typeof field.db?.foreignKey === 'object' && field.db.foreignKey.map
        ? ` @map("${field.db.foreignKey.map}")`
        : ` @map("${fieldName}")`

    let fkLine = `  ${fkPaddedName} String?${uniqueModifier}${mapModifier}`
    let relationLine = targetField
      ? `  ${paddedName} ${targetList}?  @relation(fields: [${foreignKeyField}], references: [id])`
      : `  ${paddedName} ${targetList}?  @relation("${listKey}_${fieldName}", fields: [${foreignKeyField}], references: [id])`

    if (field.db?.extendPrismaSchema) {
      const extended = field.db.extendPrismaSchema({ fkLine, relationLine })
      fkLine = extended.fkLine ?? fkLine
      relationLine = extended.relationLine
    }

    // Default to indexing foreign keys (matching Keystone behaviour) unless disabled
    const indexType = field.isIndexed ?? true
    const foreignKeyIndex = indexType !== false ? { foreignKeyField, indexType } : undefined

    return { modelLines: [fkLine, relationLine], foreignKeyIndex, backRelation }
  }

  // Non-FK side of a one-to-one relationship: just the relation field
  let relationLine = `  ${paddedName} ${targetList}?`
  if (field.db?.extendPrismaSchema) {
    relationLine = field.db.extendPrismaSchema({ relationLine }).relationLine
  }

  return { modelLines: [relationLine], backRelation }
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

  const field: RelationshipField<TTypeInfo> = {
    type: 'relationship',
    ...options,
  }

  field.getPrismaRelation = (
    fieldName: string,
    _allFields: Record<string, FieldConfig>,
    listKey: string,
    config: OpenSaasConfig,
  ) => getPrismaRelation(field as RelationshipField, fieldName, listKey, config)

  return field
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
        // Required in create mode: a value must be provided and it must be
        // non-null (issue #604 — a required json field means non-null). A bare
        // z.unknown() is treated as optional inside z.object(), so an omitted
        // key would silently pass; the refinement makes the key genuinely
        // required by rejecting undefined (which also covers an absent key) and
        // rejecting a present null, while still accepting any other present
        // JSON value (object, array, primitive, including falsy 0/""/false).
        return baseSchema.refine((value) => value !== undefined && value !== null, {
          message: `${formatFieldName(fieldName)} is required`,
        })
      } else if (isRequired && operation === 'update') {
        // Required in update mode: omitted keys still pass (issue #570 — partial
        // updates may leave the field untouched), but a present null is rejected
        // (issue #604 — required json means non-null). The `.refine()` runs
        // before `.optional()` short-circuits on undefined: absent/undefined
        // passes, a present null is rejected, and other present values pass.
        return baseSchema
          .refine((value) => value !== null, {
            message: `${formatFieldName(fieldName)} is required`,
          })
          .optional()
      } else {
        // Not required: can be undefined or null
        return baseSchema.optional().nullable()
      }
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

      // Native type modifier
      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      // Default value if provided. Uses Keystone's JSON-literal form: canonical
      // (space-free) JSON wrapped in escaped double quotes. Independent of the
      // nullable `?` modifier above — the default never overwrites nullability.
      const defaultLiteral = formatPrismaDefault(options?.defaultValue, 'json')
      if (defaultLiteral !== undefined) {
        modifiers += ` @default(${defaultLiteral})`
      }

      // Map modifier
      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'Json',
        modifiers: modifiers.trimStart() || undefined,
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
