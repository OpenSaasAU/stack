import { z } from 'zod'
import type {
  TextField,
  IntegerField,
  DecimalField,
  BigIntField,
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
  ReferentialAction,
  ColumnDefaultDescriptor,
  ColumnTypeDescriptor,
  ContractColumnDescriptor,
  ContractFieldDescriptor,
  ContractForeignKeyDescriptor,
  ContractLiteral,
  ContractRelationDescriptor,
} from '../config/types.js'
import { hashPassword, isHashedPassword, HashedPassword } from '../utils/password.js'
import { formatPrismaDefault } from './format-prisma-default.js'
import { getLabelFieldName } from '../config/label.js'
import type { FilterOperator, FilterSpec } from '../filter/types.js'
import { RELATIONSHIP_COUNT_FILTER_KEY } from '../filter/types.js'

/** Operators shared by numeric/date fields' `getFilterSpec`. */
const COMPARISON_OPERATORS: FilterOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte']

function prismaComparisonKey(operator: FilterOperator): string {
  return operator === 'eq' ? 'equals' : operator
}

// Field-config types live here, alongside the builders that produce them.
// (The umbrella `FieldConfig` and authoring `BaseFieldConfig` stay on the root
// and `/extend` entry points respectively.)
export type {
  TextField,
  IntegerField,
  DecimalField,
  BigIntField,
  CheckboxField,
  TimestampField,
  CalendarDayField,
  PasswordField,
  SelectField,
  SelectOption,
  SelectOptionVariant,
  RelationshipField,
  JsonField,
  VirtualField,
  PrismaRelationResult,
  MultiColumnPrismaResult,
  ColumnDefaultDescriptor,
  ColumnTypeDescriptor,
  ContractColumnDescriptor,
  ContractFieldDescriptor,
  ContractForeignKeyDescriptor,
  ContractLiteral,
  ContractRelationDescriptor,
} from '../config/types.js'

function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

function pgType(type: string, args?: ContractLiteral[]): ColumnTypeDescriptor {
  return args ? { pack: 'pg', type, args } : { pack: 'pg', type }
}

function isContractLiteral(value: unknown): value is ContractLiteral {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) return value.every(isContractLiteral)
  if (typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  return (
    (proto === Object.prototype || proto === null) && Object.values(value).every(isContractLiteral)
  )
}

function describeDefault(value: unknown): string {
  if (typeof value !== 'object' || value === null) return `a ${typeof value}`
  return `an instance of ${value.constructor?.name ?? 'an unnamed class'}`
}

function literalDefault(
  value: unknown,
  listKey: string,
  fieldName: string,
): ColumnDefaultDescriptor | undefined {
  if (value === undefined) return undefined
  if (!isContractLiteral(value)) {
    throw new Error(
      `"${listKey}.${fieldName}" has a defaultValue the contract cannot carry: expected a JSON ` +
        `literal (string, number, boolean, null, array or plain object), got ${describeDefault(value)}.`,
    )
  }
  return { kind: 'literal', value }
}

type ScalarColumn = {
  type: ColumnTypeDescriptor
  nullable: boolean
  nativeType?: string
  map?: string
  isIndexed?: boolean | 'unique'
  default?: ColumnDefaultDescriptor
  enum?: { name: string; values: string[] }
}

function scalarColumn(fieldName: string, column: ScalarColumn): ContractFieldDescriptor {
  const descriptor: { kind: 'column' } & ContractColumnDescriptor = {
    kind: 'column',
    name: fieldName,
    type: column.type,
    nullable: column.nullable,
  }
  if (column.nativeType !== undefined) descriptor.nativeType = column.nativeType
  if (column.map !== undefined) descriptor.map = column.map
  if (column.isIndexed === 'unique') descriptor.unique = true
  if (column.isIndexed === true) descriptor.index = true
  if (column.default !== undefined) descriptor.default = column.default
  if (column.enum !== undefined) descriptor.enum = column.enum
  return descriptor
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

      if (isNullable) {
        modifiers += '?'
      }

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

      // Unique modifier. A non-unique index has no field-level form in Prisma,
      // so it is requested out-of-line via `index` below and emitted by the
      // generator as `@@index([...])` on the model.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('text'),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
    getTypeScriptType: () => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      return {
        type: 'string',
        optional: !isRequired,
      }
    },
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: ['eq'],
      freeText: true,
      toCondition: (operator, value) =>
        operator === 'eq' ? { [fieldName]: { contains: value } } : null,
      suggestions: { valueSource: { kind: 'none' } },
    }),
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

      if (isNullable) {
        modifiers += '?'
      }

      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      const defaultLiteral = formatPrismaDefault(options?.defaultValue, 'integer')
      if (defaultLiteral !== undefined) {
        modifiers += ` @default(${defaultLiteral})`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique modifier — non-unique index routes through `index` below,
      // same as `text()`'s getPrismaType.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'Int',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('int'),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'number',
        optional: !isRequired,
      }
    },
    // A non-integer token can't be interpreted, so it degrades to free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: COMPARISON_OPERATORS,
      toCondition: (operator, value) => {
        const trimmed = value.trim()
        if (!/^-?\d+$/.test(trimmed)) return null
        return { [fieldName]: { [prismaComparisonKey(operator)]: Number(trimmed) } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }),
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

      if (isNullable) {
        modifiers += '?'
      }

      modifiers += ` @db.Decimal(${precision}, ${scale})`

      if (options?.defaultValue !== undefined) {
        modifiers += ` @default(${options.defaultValue})`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique modifier — non-unique index routes through `index` below,
      // same as `text()`'s getPrismaType.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'Decimal',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('decimal', [precision, scale]),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
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
    // Decimals compare like integers, but the value stays a string so Prisma's
    // Decimal keeps full precision. A non-numeric value degrades to free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: COMPARISON_OPERATORS,
      toCondition: (operator, value) => {
        const trimmed = value.trim()
        if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
        return { [fieldName]: { [prismaComparisonKey(operator)]: trimmed } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }),
  }
}

/**
 * 64-bit integer field for values that overflow `integer()`'s 32-bit `Int`
 * (e.g. a millisecond epoch). Prisma `BigInt`, TypeScript `bigint`.
 *
 * Accepts `bigint`, an integer `number`, or a numeric `string` on write and
 * always coerces to `bigint`. A `number` above `Number.MAX_SAFE_INTEGER` is
 * rejected rather than coerced — it has already lost precision before this
 * field sees it, so accepting it would reintroduce the exact defect this
 * field exists to prevent. Pass a `bigint` or a string for values beyond that
 * range.
 *
 * Wire representation (ADR-0029): `bigint` in application code, a decimal
 * string over MCP.
 */
export function bigInt<
  TTypeInfo extends import('../config/types.js').TypeInfo = import('../config/types.js').TypeInfo,
>(options?: Omit<BigIntField<TTypeInfo>, 'type'>): BigIntField<TTypeInfo> {
  return {
    type: 'bigInt',
    ...options,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      const coerced = z
        .union([z.bigint(), z.number(), z.string()], {
          message: `${formatFieldName(fieldName)} must be a bigint, an integer number, or a numeric string`,
        })
        .transform((val, ctx) => {
          if (typeof val === 'bigint') return val

          if (typeof val === 'number') {
            if (!Number.isInteger(val)) {
              ctx.addIssue(`${formatFieldName(fieldName)} must be an integer`)
              return z.NEVER
            }
            if (!Number.isSafeInteger(val)) {
              ctx.addIssue(
                `${formatFieldName(fieldName)} exceeds Number.MAX_SAFE_INTEGER — pass a bigint or a numeric string instead`,
              )
              return z.NEVER
            }
            return BigInt(val)
          }

          const trimmed = val.trim()
          if (!/^-?\d+$/.test(trimmed)) {
            ctx.addIssue(`${formatFieldName(fieldName)} must be an integer`)
            return z.NEVER
          }
          return BigInt(trimmed)
        })

      let schema = coerced

      if (validation?.min !== undefined) {
        const min = validation.min
        schema = schema.refine((val) => val >= min, {
          message: `${formatFieldName(fieldName)} must be at least ${min}`,
        })
      }

      if (validation?.max !== undefined) {
        const max = validation.max
        schema = schema.refine((val) => val <= max, {
          message: `${formatFieldName(fieldName)} must be at most ${max}`,
        })
      }

      return !isRequired || operation === 'update' ? schema.optional().nullable() : schema
    },
    getPrismaType: (_fieldName: string) => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired
      let modifiers = ''

      if (isNullable) {
        modifiers += '?'
      }

      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      if (options?.defaultValue !== undefined) {
        modifiers += ` @default(${options.defaultValue})`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique modifier — non-unique index routes through `index` below,
      // same as `text()`'s getPrismaType.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'BigInt',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) => {
      const defaultValue = options?.defaultValue
      return scalarColumn(fieldName, {
        type: pgType('bigint'),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        default: literalDefault(
          typeof defaultValue === 'bigint' || typeof defaultValue === 'number'
            ? defaultValue.toString()
            : defaultValue,
          listKey,
          fieldName,
        ),
      })
    },
    getTypeScriptType: () => {
      const isRequired = options?.validation?.isRequired

      return {
        type: 'bigint',
        optional: !isRequired,
      }
    },
    // A non-integer token degrades to free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: COMPARISON_OPERATORS,
      toCondition: (operator, value) => {
        const trimmed = value.trim()
        if (!/^-?\d+$/.test(trimmed)) return null
        return { [fieldName]: { [prismaComparisonKey(operator)]: BigInt(trimmed) } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }),
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

      // Checkboxes are non-nullable by default (must be true or false), unlike
      // the other scalar fields' nullable-unless-required default — set
      // db.isNullable: true to allow NULL.
      if (db?.isNullable === true) {
        modifiers += '?'
      }

      if (hasDefault) {
        modifiers += ` @default(${options.defaultValue})`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'Boolean',
        modifiers: modifiers.trimStart() || undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('boolean'),
        nullable: options?.db?.isNullable === true,
        map: options?.db?.map,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
    getTypeScriptType: () => {
      return {
        type: 'boolean',
        optional: options?.defaultValue === undefined,
      }
    },
    // Anything other than true/false degrades to free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: ['eq'],
      toCondition: (operator, value) => {
        if (operator !== 'eq') return null
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return { [fieldName]: { equals: true } }
        if (normalized === 'false') return { [fieldName]: { equals: false } }
        return null
      },
      suggestions: {
        valueSource: {
          kind: 'enum',
          options: [
            { value: 'true', label: 'True' },
            { value: 'false', label: 'False' },
          ],
        },
      },
    }),
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

      const isNullable = db?.isNullable ?? !hasDefaultNow

      let modifiers = ''

      if (isNullable) {
        modifiers += '?'
      }

      if (hasDefaultNow) {
        modifiers += ' @default(now())'
      }

      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique modifier — non-unique index routes through `index` below,
      // same as `text()`'s getPrismaType.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'DateTime',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string) => {
      const defaultValue = options?.defaultValue
      const hasDefaultNow =
        typeof defaultValue === 'object' &&
        defaultValue !== null &&
        'kind' in defaultValue &&
        defaultValue.kind === 'now'
      return scalarColumn(fieldName, {
        type: pgType('dateTime'),
        nullable: options?.db?.isNullable ?? !hasDefaultNow,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        // Only `now` reaches the schema — getPrismaType emits no @default for
        // a Date, and the descriptor must not disagree with it.
        default: hasDefaultNow ? { kind: 'now' } : undefined,
      })
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
    // An unparseable date degrades to free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: COMPARISON_OPERATORS,
      toCondition: (operator, value) => {
        const date = new Date(value.trim())
        if (Number.isNaN(date.getTime())) return null
        return { [fieldName]: { [prismaComparisonKey(operator)]: date } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }),
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
 * - **Writes:** pass a `YYYY-MM-DD` string (the declared type). A
 *   `resolveInput` hook converts a valid string to a UTC-midnight `Date`
 *   before validation, since Prisma 7's client validator rejects a bare date
 *   string for a `@db.Date` column (#621); a `Date` is also accepted
 *   directly. A malformed string is rejected at runtime by validation (a
 *   `ValidationError`). Genuine compile-time rejection of a `Date` at the
 *   `context.db` call site is tracked in #599.
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
    outputType: 'string',
    inputType: 'string',
    ...options,
    // Hook Pipeline runs field resolveInput before zod validation — the only
    // point a YYYY-MM-DD string can be turned into what Prisma's `@db.Date`
    // write validator accepts (#621). Reads resolvedData[fieldKey], not raw
    // inputData, so a list-level resolveInput's injected default for an
    // omitted key is still coerced rather than overwritten.
    hooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveInput: ({ resolvedData, fieldKey }: { resolvedData: any; fieldKey: string }) => {
        const value = resolvedData?.[fieldKey]
        if (value == null || value instanceof Date) return value
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return new Date(`${value}T00:00:00.000Z`)
        }
        return value
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveOutput: ({ value }: { value: any }) => formatCalendarDay(value),
      ...options?.hooks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hook object needs type assertion for field builder
    } as any,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      // Accepts a `Date` because resolveInput above already converted a valid
      // string to one before this schema runs; a malformed string falls
      // through resolveInput untouched and fails the regex here instead.
      const stringSchema = z
        .string({
          message: `${formatFieldName(fieldName)} must be a valid date in ISO8601 format (YYYY-MM-DD)`,
        })
        .regex(/^\d{4}-\d{2}-\d{2}$/, {
          message: `${formatFieldName(fieldName)} must be in YYYY-MM-DD format`,
        })

      const dateSchema = z.union([stringSchema, z.date()])

      if (isRequired && operation === 'create') {
        return dateSchema
      } else if (isRequired && operation === 'update') {
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

      if (isNullable) {
        modifiers += '?'
      }

      // SQLite has no native DATE type and falls back to TEXT for DateTime
      // columns, so @db.Date only applies on PostgreSQL/MySQL.
      if (provider && provider.toLowerCase() !== 'sqlite') {
        modifiers += ' @db.Date'
      }

      if (options?.defaultValue !== undefined) {
        modifiers += ` @default("${options.defaultValue}")`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      // Unique modifier — non-unique index routes through `index` below,
      // same as `text()`'s getPrismaType.
      if (options?.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'DateTime',
        modifiers: modifiers.trimStart() || undefined,
        index: options?.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('dateTime'),
        nativeType: 'date',
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        map: options?.db?.map,
        isIndexed: options?.isIndexed,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
    getTypeScriptType: () => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired

      return {
        type: 'string',
        optional: isNullable,
      }
    },
    // Calendar days compare on the `YYYY-MM-DD` value (coerced to a UTC-midnight
    // Date so it matches the `@db.Date` column). A malformed value degrades to
    // free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: COMPARISON_OPERATORS,
      toCondition: (operator, value) => {
        const trimmed = value.trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
        const date = new Date(`${trimmed}T00:00:00.000Z`)
        if (Number.isNaN(date.getTime())) return null
        return { [fieldName]: { [prismaComparisonKey(operator)]: date } }
      },
      suggestions: { valueSource: { kind: 'none' } },
    }),
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
 * - Password field values are redacted to `{ isSet: boolean }` on serialization
 *   (`JSON.stringify`, the admin UI). Field-level `read` access is not denied by
 *   default — configure `access.field.read` if the raw value should never reach
 *   `context.db` callers at all.
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
    outputType: "import('@opensaas/stack-core/internal').HashedPassword",
    ...options,
    resultExtension: {
      outputType: "import('@opensaas/stack-core/internal').HashedPassword",
    },
    ui: {
      ...options?.ui,
      // Excluded from default admin table columns (issue #1018) — declared
      // via the flag rather than matched by field type/name, so an app can
      // still opt a real password field back in with `ui.listView.defaultColumn: true`.
      listView: {
        defaultColumn: false,
        ...options?.ui?.listView,
      },
      valueForClientSerialization: ({ value }) => ({ isSet: !!value }),
    },
    hooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveInput: async ({ inputData, fieldKey }: { inputData: any; fieldKey: string }) => {
        const inputValue = inputData[fieldKey]
        if (inputValue === undefined || inputValue === null) {
          return inputValue
        }

        if (typeof inputValue !== 'string' || inputValue.length === 0) {
          return inputValue
        }

        // Idempotent: skip re-hashing a value that's already a hash.
        if (isHashedPassword(inputValue)) {
          return inputValue
        }

        return (await hashPassword(inputValue)).toString()
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field builder hooks must be generic
      resolveOutput: ({ value }: { value: any }) => {
        if (typeof value === 'string' && value.length > 0) {
          return new HashedPassword(value)
        }
        return undefined
      },
      ...options?.hooks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hook object needs type assertion for field builder
    } as any,
    getZodSchema: (fieldName: string, operation: 'create' | 'update') => {
      const validation = options?.validation
      const isRequired = validation?.isRequired

      if (isRequired && operation === 'create') {
        return z
          .string({
            message: `${formatFieldName(fieldName)} must be text`,
          })
          .min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          })
      } else if (isRequired && operation === 'update') {
        return z
          .string()
          .min(1, {
            message: `${formatFieldName(fieldName)} is required`,
          })
          .optional()
      } else {
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

      if (isNullable) {
        modifiers += '?'
      }

      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'String',
        modifiers: modifiers.trimStart() || undefined,
      }
    },
    getContractField: (fieldName: string) =>
      scalarColumn(fieldName, {
        type: pgType('text'),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
      }),
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

  const unionType = options.options.map((opt) => `'${opt.value}'`).join(' | ')

  return {
    type: 'select',
    outputType: unionType,
    inputType: unionType,
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

        // No quotes for enum default values (unlike the string branch below).
        if (hasDefault) {
          modifiers += ` @default(${options.defaultValue})`
        }

        if (options.db?.map) {
          modifiers += ` @map("${options.db.map}")`
        }

        // Unique modifier — non-unique index routes through `index` below,
        // same as `text()`'s getPrismaType.
        if (options.isIndexed === 'unique') {
          modifiers += ' @unique'
        }

        return {
          type: enumName,
          modifiers: modifiers || undefined,
          enumValues: options.options.map((opt) => opt.value),
          index: options.isIndexed === true ? true : undefined,
        }
      }

      // String type (default)

      if (hasDefault) {
        modifiers += ` @default("${options.defaultValue}")`
      }

      if (options.db?.map) {
        modifiers += ` @map("${options.db.map}")`
      }

      if (options.isIndexed === 'unique') {
        modifiers += ' @unique'
      }

      return {
        type: 'String',
        modifiers: modifiers || undefined,
        index: options.isIndexed === true ? true : undefined,
      }
    },
    getContractField: (fieldName: string, listName: string) => {
      const hasDefault = options.defaultValue !== undefined
      const nullable = options.db?.isNullable ?? (!options.validation?.isRequired && !hasDefault)
      if (!isNativeEnum) {
        return scalarColumn(fieldName, {
          type: pgType('text'),
          nullable,
          map: options.db?.map,
          isIndexed: options.isIndexed,
          default: literalDefault(options.defaultValue, listName, fieldName),
        })
      }
      const capitalizedField = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
      return scalarColumn(fieldName, {
        type: pgType('enum'),
        nullable,
        map: options.db?.map,
        isIndexed: options.isIndexed,
        default: literalDefault(options.defaultValue, listName, fieldName),
        enum: {
          name: options.db?.enumName ?? `${listName}${capitalizedField}`,
          values: options.options.map((opt) => opt.value),
        },
      })
    },
    getTypeScriptType: () => {
      return {
        type: unionType,
        optional: !options.validation?.isRequired || options.defaultValue !== undefined,
      }
    },
    // Selects filter by equality against their enumerated options. The token
    // value is matched (case-insensitively) against option value or label and
    // resolved to the canonical stored value; an unknown option degrades to
    // free text.
    getFilterSpec: (fieldName: string): FilterSpec => ({
      operators: ['eq'],
      toCondition: (operator, value) => {
        if (operator !== 'eq') return null
        const needle = value.trim().toLowerCase()
        const match = options.options.find(
          (opt) => opt.value.toLowerCase() === needle || opt.label.toLowerCase() === needle,
        )
        if (!match) return null
        return { [fieldName]: { equals: match.value } }
      },
      suggestions: {
        valueSource: {
          kind: 'enum',
          options: options.options.map((opt) => ({ value: opt.value, label: opt.label })),
        },
      },
    }),
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

/** Narrow a field config to the relationship variant. */
export function isRelationshipField(field: FieldConfig | undefined): field is RelationshipField {
  return field?.type === 'relationship'
}

/**
 * Whether `field` declares one end of a one-to-one: a bidirectional ref with
 * `many: false` on both ends. A list-only ref is never one-to-one. Throws
 * when the ref's target list or field does not exist or is not a
 * relationship.
 */
export function isOneToOneRelationship<TTypeInfo extends import('../config/types.js').TypeInfo>(
  fieldName: string,
  field: RelationshipField<TTypeInfo>,
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
 * Whether `field` claims the foreign key column of its one-to-one with
 * `db.foreignKey: true`. The `{ map }` form renames the column without
 * claiming it.
 */
export function claimsForeignKey<TTypeInfo extends import('../config/types.js').TypeInfo>(
  field: RelationshipField<TTypeInfo>,
): boolean {
  return field.db?.foreignKey === true
}

/**
 * Whether `field`'s side of its relationship owns the foreign key column: a
 * list-only ref or the to-one side of a one-to-many always does; the to-many
 * side never does; on a one-to-one the end that claims it with
 * `db.foreignKey: true` does, else the alphabetically smaller list name, else
 * (self-referential) the alphabetically smaller field name (ADR-0064).
 * Throws when both ends claim it.
 */
export function shouldHaveForeignKey<TTypeInfo extends import('../config/types.js').TypeInfo>(
  listKey: string,
  fieldName: string,
  field: RelationshipField<TTypeInfo>,
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

  const thisSideClaims = claimsForeignKey(field)
  const otherSideClaims = claimsForeignKey(targetFieldConfig)

  if (thisSideClaims && otherSideClaims) {
    throw new Error(
      `Invalid one-to-one relationship: both "${listKey}.${fieldName}" and "${targetList}.${targetField}" have db.foreignKey set to true. Only one side can store the foreign key.`,
    )
  }

  if (thisSideClaims) {
    return true
  }

  if (otherSideClaims) {
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
 * The Prisma 7 relationship options the config types no longer carry. The PSL
 * generator that reads them is deleted by #1134; until then it reads a
 * runtime object through this shim.
 */
type LegacyPrisma7RelationshipDb = NonNullable<RelationshipField['db']> & {
  relationName?: string
  extendPrismaSchema?: (lines: { fkLine?: string; relationLine: string }) => {
    fkLine?: string
    relationLine: string
  }
}

type LegacyPrisma7DatabaseConfig = OpenSaasConfig['db'] & {
  joinTableNaming?: 'prisma' | 'keystone'
}

function legacyDb(field: RelationshipField): LegacyPrisma7RelationshipDb | undefined {
  return field.db
}

const PSL_REFERENTIAL_ACTIONS: Record<ReferentialAction, string> = {
  cascade: 'Cascade',
  restrict: 'Restrict',
  noAction: 'NoAction',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
}

function pslReferentialArgs(field: RelationshipField): string {
  const args: string[] = []
  if (field.db?.onDelete) args.push(`onDelete: ${PSL_REFERENTIAL_ACTIONS[field.db.onDelete]}`)
  if (field.db?.onUpdate) args.push(`onUpdate: ${PSL_REFERENTIAL_ACTIONS[field.db.onUpdate]}`)
  return args.map((arg) => `${arg}, `).join('')
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
  const db: LegacyPrisma7DatabaseConfig = config.db
  const joinTableNaming = db.joinTableNaming || 'prisma'

  const sourceRelationName = legacyDb(field)?.relationName
  let targetRelationName: string | undefined
  if (targetField) {
    const targetFieldConfig = config.lists[targetList]?.fields[targetField]
    if (targetFieldConfig?.type === 'relationship') {
      targetRelationName = legacyDb(targetFieldConfig as RelationshipField)?.relationName
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

  return undefined
}

/**
 * The name Prisma generation synthesizes for the back-relation a list-only
 * `ref` (`ref: 'ListName'`, no target field) creates on its target model —
 * Prisma requires an opposite field, and the config never declares one.
 * Exported so runtime nested-write resolution (`resolveSyntheticReverseRelation`
 * in `access/engine.ts`) can recognise the same name rather than re-deriving
 * the format by string parsing (#978).
 */
export function getSyntheticFieldName(listKey: string, fieldName: string): string {
  return `from_${listKey}_${fieldName}`
}

function nullableOnNonOwningSideMessage(
  listKey: string,
  fieldName: string,
  targetList: string,
  targetField: string | undefined,
): string {
  return (
    `db.isNullable can only be used on the foreign-key-owning side of a relationship. ` +
    `"${listKey}.${fieldName}" does not own the foreign key for this one-to-one relationship — ` +
    `set db.isNullable on "${targetList}.${targetField}" instead, or make this side own the ` +
    `foreign key via db.foreignKey.`
  )
}

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
    const syntheticFieldName = getSyntheticFieldName(listKey, fieldName)
    const relationName = legacyDb(field)?.relationName ?? `${listKey}_${fieldName}`
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
      const relationName = legacyDb(field)?.relationName ?? `${listKey}_${fieldName}`
      relationLine = `  ${paddedName} ${targetList}[]  @relation("${relationName}")`
    }

    const extendPrismaSchema = legacyDb(field)?.extendPrismaSchema
    if (extendPrismaSchema) {
      relationLine = extendPrismaSchema({ relationLine }).relationLine
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

    // Nullability: explicit db.isNullable overrides the default (nullable),
    // matching the scalar fields' `db.isNullable` convention. It moves the FK
    // column and its relation field together — they can never disagree.
    const isNullable = field.db?.isNullable ?? true
    const nullModifier = isNullable ? '?' : ''

    const referentialArgs = pslReferentialArgs(field)
    let fkLine = `  ${fkPaddedName} String${nullModifier}${uniqueModifier}${mapModifier}`
    let relationLine = targetField
      ? `  ${paddedName} ${targetList}${nullModifier}  @relation(${referentialArgs}fields: [${foreignKeyField}], references: [id])`
      : `  ${paddedName} ${targetList}${nullModifier}  @relation("${listKey}_${fieldName}", ${referentialArgs}fields: [${foreignKeyField}], references: [id])`

    const extendPrismaSchema = legacyDb(field)?.extendPrismaSchema
    if (extendPrismaSchema) {
      const extended = extendPrismaSchema({ fkLine, relationLine })
      fkLine = extended.fkLine ?? fkLine
      relationLine = extended.relationLine
    }

    // Default to indexing foreign keys (matching Keystone behaviour) unless disabled
    const indexType = field.isIndexed ?? true
    const foreignKeyIndex = indexType !== false ? { foreignKeyField, indexType } : undefined

    return { modelLines: [fkLine, relationLine], foreignKeyField, foreignKeyIndex, backRelation }
  }

  // Non-FK side of a one-to-one relationship: just the relation field. This
  // side has no foreign key column, so `db.isNullable` (which only makes
  // sense paired with a column) cannot be honoured here — reject rather than
  // silently ignore a developer's stated intent (the FK-owning side is
  // determined by `db.foreignKey`/alphabetical ordering, not by which field
  // declares `isNullable`).
  if (field.db?.isNullable === false) {
    throw new Error(nullableOnNonOwningSideMessage(listKey, fieldName, targetList, targetField))
  }

  let relationLine = `  ${paddedName} ${targetList}?`
  const extendPrismaSchema = legacyDb(field)?.extendPrismaSchema
  if (extendPrismaSchema) {
    relationLine = extendPrismaSchema({ relationLine }).relationLine
  }

  return { modelLines: [relationLine], backRelation }
}

function getContractRelation<TTypeInfo extends import('../config/types.js').TypeInfo>(
  field: RelationshipField<TTypeInfo>,
  fieldName: string,
  listKey: string,
  config: OpenSaasConfig,
): ContractRelationDescriptor {
  const { list: target, field: targetField } = parseRelationshipRef(field.ref)
  const inverse = targetField
    ? { field: targetField, synthetic: false }
    : { field: getSyntheticFieldName(listKey, fieldName), synthetic: true }

  if (field.many) {
    return { kind: 'relation', target, inverse, many: true }
  }

  if (!shouldHaveForeignKey(listKey, fieldName, field, config)) {
    if (field.db?.isNullable === false) {
      throw new Error(nullableOnNonOwningSideMessage(listKey, fieldName, target, targetField))
    }
    return { kind: 'relation', target, inverse, many: false }
  }

  const foreignKey: ContractForeignKeyDescriptor = {
    name: `${fieldName}Id`,
    map:
      typeof field.db?.foreignKey === 'object' ? (field.db.foreignKey.map ?? fieldName) : fieldName,
    nullable: field.db?.isNullable ?? true,
    unique: field.isIndexed === 'unique' || isOneToOneRelationship(fieldName, field, config),
    index: field.isIndexed === undefined || field.isIndexed === true,
    references: { list: target, field: 'id' },
  }

  return { kind: 'relation', target, inverse, many: false, foreignKey }
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

  const refParts = options.ref.split('.')
  if (refParts.length !== 1 && refParts.length !== 2) {
    throw new Error(
      `Invalid relationship ref format: "${options.ref}". Expected format: "ListName.fieldName" or "ListName"`,
    )
  }

  if (options.db?.foreignKey !== undefined) {
    if (options.many) {
      throw new Error(
        'db.foreignKey can only be used on single relationships (many: false or undefined). ' +
          'Many-side of a relationship never stores the foreign key.',
      )
    }

    if (refParts.length === 1 && typeof options.db.foreignKey === 'boolean') {
      throw new Error(
        'db.foreignKey cannot be a boolean on list-only refs (ref: "ListName"). ' +
          'List-only refs always create foreign keys automatically, so the ownership sense of ' +
          'db.foreignKey is meaningless here. Use db.foreignKey: { map: "columnName" } to rename ' +
          'the foreign key column instead.',
      )
    }
  }

  if (options.db?.isNullable !== undefined && options.many) {
    throw new Error(
      'db.isNullable can only be used on single relationships (many: false or undefined). ' +
        'Many-side of a relationship has no foreign key column to make non-nullable.',
    )
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

  field.getContractField = (fieldName: string, listKey: string, config: OpenSaasConfig) =>
    getContractRelation(field, fieldName, listKey, config)

  // Relationships filter differently by cardinality (issue #732):
  //  • to-one filters by the related Item's label — `author:"Ada Lovelace"`
  //    becomes a nested `is` `contains` on the target list's Label field.
  //  • to-many filters by the access-visible related COUNT with numeric
  //    comparisons — `orders:>5`. Prisma cannot compare a relation count in a
  //    `where`, so the mapper emits a structured count marker
  //    (RELATIONSHIP_COUNT_FILTER_KEY) that `resolveRelationshipCountFilters`
  //    later turns into an access-scoped `{ id: { in } }`.
  // The mapper stays pure in both cases (no DB lookup). Suggestions point a
  // to-one at the target list's label lookup; a to-many exposes no value source
  // (a numeric compare, like an integer field).
  field.getFilterSpec = (
    _fieldName: string,
    _listKey: string,
    config: OpenSaasConfig,
  ): FilterSpec | undefined => {
    const { list: targetList } = parseRelationshipRef(field.ref)
    const relatedListConfig = config.lists[targetList]
    if (!relatedListConfig) return undefined

    if (field.many === true) {
      return {
        operators: COMPARISON_OPERATORS,
        toCondition: (operator, value) => {
          const trimmed = value.trim()
          // A non-integer count comparison can't be interpreted → degrade to
          // free text (matching the integer field's behaviour).
          if (!/^-?\d+$/.test(trimmed)) return null
          return {
            [_fieldName]: { [RELATIONSHIP_COUNT_FILTER_KEY]: { operator, value: Number(trimmed) } },
          }
        },
        suggestions: { valueSource: { kind: 'none' } },
      }
    }

    const labelField = getLabelFieldName(relatedListConfig)
    const labelFieldConfig = relatedListConfig.fields[labelField]
    // A virtual label field has no queryable column, so `contains` can't run
    // against it — the relationship is then not filterable.
    if (labelFieldConfig?.virtual === true) return undefined

    return {
      operators: ['eq'],
      toCondition: (operator, value) => {
        if (operator !== 'eq') return null
        return { [_fieldName]: { is: { [labelField]: { contains: value } } } }
      },
      suggestions: { valueSource: { kind: 'relationship', listKey: targetList, many: false } },
    }
  }

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
        return baseSchema.optional().nullable()
      }
    },
    getPrismaType: (_fieldName: string) => {
      const validation = options?.validation
      const db = options?.db
      const isRequired = validation?.isRequired
      const isNullable = db?.isNullable ?? !isRequired
      let modifiers = ''

      if (isNullable) {
        modifiers += '?'
      }

      if (db?.nativeType) {
        modifiers += ` @db.${db.nativeType}`
      }

      const defaultLiteral = formatPrismaDefault(options?.defaultValue, 'json')
      if (defaultLiteral !== undefined) {
        modifiers += ` @default(${defaultLiteral})`
      }

      if (db?.map) {
        modifiers += ` @map("${db.map}")`
      }

      return {
        type: 'Json',
        modifiers: modifiers.trimStart() || undefined,
      }
    },
    getContractField: (fieldName: string, listKey: string) =>
      scalarColumn(fieldName, {
        type: pgType('jsonb'),
        nullable: options?.db?.isNullable ?? !options?.validation?.isRequired,
        nativeType: options?.db?.nativeType,
        map: options?.db?.map,
        default: literalDefault(options?.defaultValue, listKey, fieldName),
      }),
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

  const typeName = descriptor.name || descriptor.value.name

  return `import('${descriptor.from}').${typeName}`
}

function typeDescriptorToImports(
  descriptor: import('../config/types.js').TypeDescriptor,
): Array<{ names: string[]; from: string; typeOnly?: boolean }> {
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
  if (!options.hooks?.resolveOutput) {
    throw new Error(
      'Virtual fields must provide a resolveOutput hook to compute their value. ' +
        'Example: hooks: { resolveOutput: ({ item }) => computeValue(item) }',
    )
  }

  const outputType = typeDescriptorToString(options.type)
  const imports = typeDescriptorToImports(options.type)

  const { type: _, ...rest } = options

  return {
    type: 'virtual',
    virtual: true,
    outputType,
    ...rest,
    // undefined signals the generator to skip creating a database column.
    getPrismaType: undefined,
    getContractField: () => ({ kind: 'computed' }),
    getTypeScriptType: () => {
      return {
        type: outputType,
        optional: false, // A virtual field always computes a value.
      }
    },
    getTypeScriptImports: imports.length > 0 ? () => imports : undefined,
    // Virtual fields don't accept database input, so validation always fails.
    getZodSchema: () => {
      return z.never()
    },
  }
}
