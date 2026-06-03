import type { AccessControl, FieldAccess } from '../access/types.js'
import type { z } from 'zod'

/**
 * Field configuration types
 */
export type FieldType =
  | 'text'
  | 'integer'
  | 'checkbox'
  | 'timestamp'
  | 'password'
  | 'select'
  | 'relationship'
  | string // Allow custom field types from third-party packages

/**
 * Field-level hook argument types (exported for user annotations)
 */

/**
 * Arguments for field-level resolveInput hook
 * Used to transform field values before database write
 */
export type FieldResolveInputHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      inputData: TTypeInfo['inputs']['create']
      item: undefined
      resolvedData: TTypeInfo['inputs']['create']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      inputData: TTypeInfo['inputs']['update']
      item: TTypeInfo['item']
      resolvedData: TTypeInfo['inputs']['update']
      context: import('../access/types.js').AccessContext
    }

/**
 * Arguments for field-level validate hook
 * Used for custom validation logic
 */
export type FieldValidateHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      inputData: TTypeInfo['inputs']['create']
      item: undefined
      resolvedData: TTypeInfo['inputs']['create']
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      inputData: TTypeInfo['inputs']['update']
      item: TTypeInfo['item']
      resolvedData: TTypeInfo['inputs']['update']
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      item: TTypeInfo['item']
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }

/**
 * Arguments for field-level beforeOperation hook
 * Used for side effects before database write
 */
export type FieldBeforeOperationHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      inputData: TTypeInfo['inputs']['create']
      resolvedData: TTypeInfo['inputs']['create']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      inputData: TTypeInfo['inputs']['update']
      item: TTypeInfo['item']
      resolvedData: TTypeInfo['inputs']['update']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      item: TTypeInfo['item']
      context: import('../access/types.js').AccessContext
    }

/**
 * Arguments for field-level afterOperation hook
 * Used for side effects after database operation
 */
export type FieldAfterOperationHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      inputData: TTypeInfo['inputs']['create']
      item: TTypeInfo['item']
      resolvedData: TTypeInfo['inputs']['create']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      inputData: TTypeInfo['inputs']['update']
      originalItem: TTypeInfo['item']
      item: TTypeInfo['item']
      resolvedData: TTypeInfo['inputs']['update']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      originalItem: TTypeInfo['item']
      context: import('../access/types.js').AccessContext
    }

/**
 * Arguments for field-level resolveOutput hook
 * Used to transform field values after database read
 */
export type FieldResolveOutputHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> = {
  operation: 'query'
  value: GetFieldValueType<TTypeInfo['fields'], TFieldKey>
  item: TTypeInfo['item']
  listKey: string
  fieldName: TFieldKey
  context: import('../access/types.js').AccessContext
}

/**
 * Field-level hooks for data transformation and side effects
 * Allows field types to define custom behavior during operations
 *
 * @template TTypeInfo - List type information including item and input types
 * @template TFieldKey - The specific field name (defaults to any field in the list)
 *
 * @example
 * ```typescript
 * // For a 'title' field on Post list:
 * FieldHooks<Lists.Post.TypeInfo, 'title'>
 * // resolveOutput returns: string | undefined (field-specific)
 *
 * // Generic (for field builders):
 * FieldHooks<TTypeInfo>
 * // resolveOutput returns: union of all field types
 * ```
 */
export type FieldHooks<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> = {
  /**
   * Transform field value before database write
   * Called during create/update operations after list-level resolveInput but before validation
   * This is where you should transform input data (e.g., hash passwords, normalize values)
   *
   * @example
   * ```typescript
   * resolveInput: async ({ listKey, fieldKey, operation, inputData, item, resolvedData, context }) => {
   *   // For create operations, item is undefined
   *   // For update operations, item is the existing record
   *   const fieldValue = resolvedData[fieldKey]
   *   if (typeof fieldValue === 'string' && !isHashedPassword(fieldValue)) {
   *     return await hashPassword(fieldValue)
   *   }
   *   return fieldValue
   * }
   * ```
   */
  resolveInput?: (
    args: FieldResolveInputHookArgs<TTypeInfo, TFieldKey>,
  ) =>
    | Promise<GetFieldValueType<TTypeInfo['fields'], TFieldKey> | undefined>
    | GetFieldValueType<TTypeInfo['fields'], TFieldKey>
    | undefined

  /**
   * Validate field value after resolveInput
   * Called during create/update operations after resolveInput hooks but before database write
   * Use addValidationError to report validation failures
   *
   * @example
   * ```typescript
   * validate: async ({ listKey, fieldKey, operation, inputData, item, resolvedData, context, addValidationError }) => {
   *   if (operation === 'delete') return
   *   const fieldValue = resolvedData[fieldKey]
   *   if (typeof fieldValue === 'string' && fieldValue.includes('spam')) {
   *     addValidationError('Field cannot contain spam')
   *   }
   * }
   * ```
   */
  validate?: (args: FieldValidateHookArgs<TTypeInfo, TFieldKey>) => Promise<void> | void

  /**
   * @deprecated Use 'validate' instead. This alias is provided for backwards compatibility.
   */
  validateInput?: (args: FieldValidateHookArgs<TTypeInfo, TFieldKey>) => Promise<void> | void

  /**
   * Perform side effects before database write
   * Called during create/update/delete operations after validation and access control
   * This should ONLY contain side effects (logging, notifications, etc.), not data transformation
   *
   * @example
   * ```typescript
   * beforeOperation: async ({ listKey, fieldKey, operation, inputData, item, resolvedData, context }) => {
   *   // For create operations, item is undefined
   *   // For update/delete operations, item is the existing record
   *   const fieldValue = resolvedData?.[fieldKey]
   *   if (operation === 'update' && item) {
   *     console.log(`Updating field from ${item[fieldKey]} to ${fieldValue}`)
   *   }
   *   await sendAuditLog({ operation, item })
   * }
   * ```
   */
  beforeOperation?: (
    args: FieldBeforeOperationHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void

  /**
   * Perform side effects after database operation
   * Called after any database operation (create/update/delete)
   * This should ONLY contain side effects (logging, cache invalidation, etc.), not data transformation
   *
   * @example
   * ```typescript
   * afterOperation: async ({ listKey, fieldKey, operation, inputData, item, originalItem, resolvedData, context }) => {
   *   // For create operations, originalItem is undefined
   *   // For update/delete operations, originalItem is the item before the operation
   *   if (operation === 'update' && originalItem) {
   *     console.log('Changed from:', originalItem[fieldKey], 'to:', item[fieldKey])
   *   }
   *   await invalidateCache({ listKey, itemId: item.id })
   *   await sendWebhook({ operation, item })
   * }
   * ```
   */
  afterOperation?: (args: FieldAfterOperationHookArgs<TTypeInfo, TFieldKey>) => Promise<void> | void

  /**
   * Transform field value after database read
   * Called when returning results from query operations
   * This is where you should transform output data (e.g., wrap passwords, format values)
   *
   * Supports both sync and async implementations. When async, the hook will be
   * properly awaited before returning results.
   *
   * @example
   * ```typescript
   * // Sync example
   * resolveOutput: ({ value }) => {
   *   if (typeof value === 'string' && value.length > 0) {
   *     return new HashedPassword(value)
   *   }
   *   return value
   * }
   *
   * // Async example (e.g., for virtual fields that query the database)
   * resolveOutput: async ({ item, context }) => {
   *   const related = await context.db.otherList.findUnique({ where: { id: item.relatedId } })
   *   return related?.name
   * }
   * ```
   */
  resolveOutput?: (
    args: FieldResolveOutputHookArgs<TTypeInfo, TFieldKey>,
  ) =>
    | GetFieldValueType<TTypeInfo['fields'], TFieldKey>
    | undefined
    | Promise<GetFieldValueType<TTypeInfo['fields'], TFieldKey> | undefined>
}

/**
 * Configuration for Prisma result extensions
 * Allows fields to transform their runtime values and types in query results
 *
 * Runtime transformation is delegated to the field's resolveOutput hook.
 * This config only specifies the TypeScript output type for generated types.
 */
export type ResultExtensionConfig = {
  /**
   * The TypeScript type to use in query result types
   * This is a type expression like: "import('@opensaas/stack-core').HashedPassword"
   *
   * The actual runtime transformation is performed by the field's resolveOutput hook.
   * The Prisma extension will automatically call the hook if it exists.
   *
   * @example "import('@opensaas/stack-core').HashedPassword"
   * @example "import('./types').MyCustomType"
   */
  outputType: string
  /**
   * @deprecated No longer used. Runtime transformations are handled by resolveOutput hooks.
   * This field is kept for backwards compatibility but should not be used in new code.
   */
  compute?: string
}

export type BaseFieldConfig<TTypeInfo extends TypeInfo> = {
  type: string
  access?: FieldAccess<
    TTypeInfo['item'],
    TTypeInfo['inputs']['create'],
    TTypeInfo['inputs']['update']
  >
  defaultValue?: unknown
  hooks?: FieldHooks<TTypeInfo>
  /**
   * Marks this field as virtual - not stored in database
   * Virtual fields use resolveInput/resolveOutput hooks for computation
   * They are excluded from Prisma schema and input types
   * Only computed when explicitly selected/included in queries
   */
  virtual?: boolean
  /**
   * Prisma result extension configuration
   * Transforms field values and types in query results using Prisma's native extension system
   */
  resultExtension?: ResultExtensionConfig
  /**
   * Database configuration
   */
  db?: {
    /**
     * Custom database column name
     * Adds a @map attribute in Prisma schema
     * @example
     * ```typescript
     * fields: {
     *   firstName: text({ db: { map: 'first_name' } })
     * }
     * // Generates: firstName String @map("first_name")
     * ```
     */
    map?: string
    /**
     * Controls DB-level nullability independently of validation.isRequired.
     * When specified, overrides the default behavior where nullability is inferred
     * from validation.isRequired (required = non-nullable, optional = nullable).
     *
     * This allows you to:
     * - Make a field non-nullable at the DB level without making it API-required
     * - Explicitly mark a field as nullable even when it has isRequired validation
     *
     * @example
     * ```typescript
     * // DB non-nullable, but API optional (relies on a default value or hook)
     * fields: {
     *   phoneNumber: text({
     *     db: { isNullable: false }
     *   })
     *   // Generates: phoneNumber String (non-nullable)
     *
     *   // DB nullable (explicit), regardless of validation
     *   lastMessagePreview: text({
     *     db: { isNullable: true }
     *   })
     *   // Generates: lastMessagePreview String? (nullable)
     * }
     * ```
     */
    isNullable?: boolean
    /**
     * Override the native database type for the column.
     * Generates a @db.<nativeType> attribute in the Prisma schema.
     * The available types depend on your database provider.
     *
     * @example
     * ```typescript
     * // PostgreSQL: use TEXT instead of VARCHAR
     * fields: {
     *   description: text({ db: { nativeType: 'Text' } })
     *   // Generates: description String? @db.Text
     *
     *   // PostgreSQL: use SMALLINT instead of INT
     *   count: integer({ db: { nativeType: 'SmallInt' } })
     *   // Generates: count Int? @db.SmallInt
     * }
     * ```
     */
    nativeType?: string
  }
  ui?: {
    /**
     * Custom React component to render this field
     * Overrides the default component for this field type
     * Uses `any` to accept any React component type without overly complex generics
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: any
    /**
     * Custom field type name to use from the global registry
     * e.g., "color" to use a globally registered ColorPickerField
     */
    fieldType?: string
    /**
     * Transform field value before sending to client (browser)
     * Useful for sensitive fields (e.g., passwords) or complex data structures
     * that shouldn't be serialized in their raw form
     *
     * @example
     * ```typescript
     * // Password field: send only whether it's set, not the hash
     * valueForClientSerialization: ({ value }) => ({ isSet: !!value })
     * ```
     */
    valueForClientSerialization?: (args: { value: unknown }) => unknown
    /**
     * Additional UI-specific configuration
     */
    [key: string]: unknown
  }
  /**
   * Generate Zod schema for this field
   * @param fieldName - The name of the field (for error messages)
   * @param operation - Whether this is a create or update operation
   */
  getZodSchema?: (fieldName: string, operation: 'create' | 'update') => z.ZodTypeAny
  /**
   * Get Prisma type and modifiers for schema generation
   * @param fieldName - The name of the field (for generating modifiers)
   * @param provider - Optional database provider ('sqlite', 'postgresql', 'mysql', etc.)
   * @param listName - Optional list name (used for generating enum type names)
   * @param keystoneCompat - Whether Keystone-compat mode is enabled (db.keystoneCompat).
   *   When true, non-null text columns without an explicit defaultValue emit
   *   `@default("")` to match Keystone 6's implicit empty-string text default.
   * @returns Prisma type string, optional modifiers, and optional enum values
   */
  getPrismaType?: (
    fieldName: string,
    provider?: string,
    listName?: string,
    keystoneCompat?: boolean,
  ) => {
    type: string
    modifiers?: string
    /**
     * If set, this field requires a Prisma enum definition with these values.
     * The enum name is the value of `type`.
     */
    enumValues?: string[]
  }
  /**
   * Get TypeScript type information for type generation
   * @returns TypeScript type string and optionality
   */
  getTypeScriptType?: () => {
    type: string
    optional: boolean
  }
  /**
   * Get TypeScript imports needed for this field's type
   * @returns Array of import statements needed for the generated types file
   */
  getTypeScriptImports?: () => Array<{
    /**
     * The type/value names to import
     * e.g., ['StoredEmbedding', 'EmbeddingMetadata']
     */
    names: string[]
    /**
     * The module to import from
     * e.g., '@opensaas/stack-rag'
     */
    from: string
    /**
     * Whether this is a type-only import
     * @default true
     */
    typeOnly?: boolean
  }>
}

export type TextField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'text'
  validation?: {
    isRequired?: boolean
    length?: {
      min?: number
      max?: number
    }
  }
  isIndexed?: boolean | 'unique'
  ui?: {
    displayMode?: 'input' | 'textarea'
  }
}

export type IntegerField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'integer'
  validation?: {
    isRequired?: boolean
    min?: number
    max?: number
  }
}

export type DecimalField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'decimal'
  defaultValue?: string
  precision?: number
  scale?: number
  validation?: {
    isRequired?: boolean
    min?: string
    max?: string
  }
  isIndexed?: boolean | 'unique'
}

export type CheckboxField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'checkbox'
}

export type TimestampField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'timestamp'
  defaultValue?: { kind: 'now' } | Date
}

export type CalendarDayField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'calendarDay'
  defaultValue?: string
  validation?: {
    isRequired?: boolean
  }
  isIndexed?: boolean | 'unique'
}

export type PasswordField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'password'
  validation?: {
    isRequired?: boolean
  }
}

export type SelectField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'select'
  options: Array<{ label: string; value: string }>
  defaultValue?: string
  db?: {
    /**
     * Whether to store as a native database enum type.
     * - 'string' (default): stores as a plain string/varchar column
     * - 'enum': stores as a Prisma enum, generating a native enum type in the schema
     *
     * Note: enum values must be valid Prisma identifiers (letters, numbers, underscores,
     * starting with a letter) when using 'enum' type.
     *
     * @default 'string'
     */
    type?: 'string' | 'enum'
    map?: string
  }
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
  }
}

export type RelationshipField<TTypeInfo extends TypeInfo = TypeInfo> =
  BaseFieldConfig<TTypeInfo> & {
    type: 'relationship'
    ref: string // Format: 'ListName.fieldName' or 'ListName'
    many?: boolean
    /**
     * Controls whether to create an index on the foreign key field
     * Defaults to true for all foreign key fields (matching Keystone behavior)
     * Can be set to 'unique' for unique constraints or false to disable indexing
     *
     * @default true (for foreign key fields)
     *
     * @example
     * ```typescript
     * // Standard indexed foreign key (default)
     * author: relationship({ ref: 'User.posts' })
     * // Generates: @@index([authorId])
     *
     * // Unique foreign key (one-to-one)
     * author: relationship({ ref: 'User.posts', isIndexed: 'unique' })
     * // Generates: @@unique([authorId])
     *
     * // Disable indexing (not recommended, may cause performance issues)
     * author: relationship({ ref: 'User.posts', isIndexed: false })
     * // No index generated
     * ```
     */
    isIndexed?: boolean | 'unique'
    db?: {
      /**
       * Controls foreign key placement and column name for bidirectional relationships
       * Can be a boolean or an object with a map property
       * Only valid on single (non-many) relationships
       * Cannot be true on both sides of a one-to-one relationship
       *
       * When a boolean, defaults the foreign key column name to the field name
       * When an object with map, uses the provided column name
       *
       * @example
       * ```typescript
       * // One-to-one: User has one Account (default foreign key name)
       * User: list({
       *   fields: {
       *     account: relationship({ ref: 'Account.user', db: { foreignKey: true } })
       *     // Generates: accountId String? @unique
       *   }
       * })
       *
       * // One-to-one: User has one Account (custom foreign key name)
       * User: list({
       *   fields: {
       *     account: relationship({ ref: 'Account.user', db: { foreignKey: { map: 'account_id' } } })
       *     // Generates: accountId String? @unique @map("account_id")
       *   }
       * })
       *
       * Account: list({
       *   fields: {
       *     user: relationship({ ref: 'User.account' }) // No foreign key on this side
       *   }
       * })
       * ```
       */
      foreignKey?: boolean | { map?: string }
      /**
       * Custom relation name for many-to-many relationships
       * Overrides the global joinTableNaming setting
       * Prisma will create an implicit join table named _relationName
       * Only needs to be set on one side of a bidirectional relationship
       *
       * @example KeystoneJS-style naming for migration
       * ```typescript
       * Lesson: list({
       *   fields: {
       *     teachers: relationship({
       *       ref: 'Teacher.lessons',
       *       many: true,
       *       db: { relationName: 'Lesson_teachers' }
       *       // Prisma creates join table _Lesson_teachers
       *     })
       *   }
       * })
       *
       * Teacher: list({
       *   fields: {
       *     lessons: relationship({ ref: 'Lesson.teachers', many: true })
       *     // Automatically uses same relationName from other side
       *   }
       * })
       * ```
       */
      relationName?: string
      /**
       * Extend or modify the generated Prisma schema lines for this relationship field
       * Receives the generated FK line (if applicable) and relation line
       * Returns the modified lines
       *
       * @example Add onDelete cascade for self-referential relationship
       * ```typescript
       * parent: relationship({
       *   ref: 'Category.children',
       *   db: {
       *     foreignKey: true,
       *     extendPrismaSchema: ({ fkLine, relationLine }) => ({
       *       fkLine,
       *       relationLine: relationLine.replace(
       *         '@relation(',
       *         '@relation(onDelete: SetNull, '
       *       )
       *     })
       *   }
       * })
       * ```
       */
      extendPrismaSchema?: (lines: {
        /** The foreign key field line (e.g., "parentId String?"), only present for single relationships that own the FK */
        fkLine?: string
        /** The relation field line (e.g., "parent Category? @relation(...)") */
        relationLine: string
      }) => {
        fkLine?: string
        relationLine: string
      }
    }
    ui?: {
      displayMode?: 'select' | 'cards'
    }
    /**
     * Get the complete Prisma schema contribution for this relationship field.
     *
     * Relationships are special: unlike scalar fields (which return a single
     * type via `getPrismaType`), a relationship can contribute a foreign key
     * line, a relation line on the owning model, and a synthetic back-relation
     * line on the target model. This method encapsulates all of that logic so
     * the generator can remain a neutral coordinator.
     *
     * @param fieldName - The name of this relationship field
     * @param allFields - All fields on the list this relationship belongs to
     * @param listKey - The name of the list this relationship belongs to
     * @param config - The full OpenSaas config (used to resolve the target list/field)
     */
    getPrismaRelation?: (
      fieldName: string,
      allFields: Record<string, FieldConfig>,
      listKey: string,
      config: OpenSaasConfig,
    ) => PrismaRelationResult
  }

/**
 * The complete Prisma schema contribution of a relationship field.
 */
export type PrismaRelationResult = {
  /**
   * Lines to add to the owning model.
   * For an FK-owning single relationship this is `[fkLine, relationLine]`;
   * for the many side or the non-FK side it is `[relationLine]`.
   */
  modelLines: string[]
  /**
   * Foreign key index to add to the owning model, if this side owns an
   * indexed foreign key.
   */
  foreignKeyIndex?: {
    foreignKeyField: string
    indexType: boolean | 'unique'
  }
  /**
   * Synthetic back-relation field to add to the target model. Only present
   * for list-only refs (e.g., `ref: 'Category'`), where the target model
   * needs an opposite relation field for Prisma to validate the relation.
   */
  backRelation?: {
    targetList: string
    line: string
  }
}

export type JsonField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'json'
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    placeholder?: string
    rows?: number
    formatted?: boolean
  }
}

/**
 * Type descriptor for virtual fields
 * Supports three formats:
 * 1. Primitive string: 'string', 'number', 'boolean', 'Date', etc.
 * 2. Import string: "import('decimal.js').Decimal"
 * 3. Type object descriptor: { value: Decimal, from: 'decimal.js', name: 'Decimal' }
 */
export type TypeDescriptor =
  | string
  | {
      /**
       * The type constructor or class
       * @example Decimal (from decimal.js)
       * @example MyCustomClass
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Constructor can have any signature
      value: new (...args: any[]) => any
      /**
       * The module to import from
       * @example 'decimal.js'
       * @example '@myorg/custom-types'
       */
      from: string
      /**
       * Optional custom name (defaults to constructor.name)
       * Useful when constructor name doesn't match export name
       * @example 'Decimal' when constructor.name is different
       */
      name?: string
    }

export type VirtualField<TTypeInfo extends TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'virtual'
  virtual: true
  /**
   * TypeScript type string for the virtual field output
   * e.g., 'string', 'number', 'boolean', 'string[]', etc.
   */
  outputType: string
}

/**
 * Generic field configuration type
 * Simplified to just BaseFieldConfig to reduce type complexity
 * Specific field types (TextField, IntegerField, etc.) are used by field builders
 * but at the config level we treat all fields uniformly
 */
export type FieldConfig = BaseFieldConfig<TypeInfo>

/**
 * List configuration types
 */

/**
 * Utility type to inject TypeInfo into a single field config
 * Extracts TInput and TOutput from BaseFieldConfig and reconstructs with new TypeInfo
 */
type WithTypeInfo<TTypeInfo extends TypeInfo> = BaseFieldConfig<TTypeInfo>

/**
 * Utility type to transform all fields in a record to inject TypeInfo
 * Maps over each field and applies WithTypeInfo transformation
 */
export type FieldsWithTypeInfo<TTypeInfo extends TypeInfo> = {
  [key: string]: WithTypeInfo<TTypeInfo>
}

/**
 * Parse TypeScript type string to actual type
 * Handles: 'string', 'number', 'boolean', 'Date', unions, string literals, imports
 *
 * @example
 * ParseTypeString<'string'> => string
 * ParseTypeString<'number'> => number
 * ParseTypeString<"'draft' | 'published'"> => 'draft' | 'published'
 * ParseTypeString<"import('@opensaas/stack-core').HashedPassword"> => any (fallback for imports)
 */
type ParseTypeString<T extends string> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'Date'
        ? Date
        : T extends 'unknown'
          ? unknown
          : T extends `'${infer U}'`
            ? U // String literal
            : T extends `${infer U} | ${infer V}`
              ? ParseTypeString<U> | ParseTypeString<V> // Union
              : T extends `import(${string}).${string}`
                ? any // eslint-disable-line @typescript-eslint/no-explicit-any -- Import types can't be resolved at compile time
                : unknown // Fallback

/**
 * Extract field value type from a field config
 * Uses the field's getTypeScriptType() method result
 * If resultExtension is present, uses its outputType instead
 *
 * @example
 * ExtractFieldValueType<TextField> => string | null | undefined (if optional)
 * ExtractFieldValueType<IntegerField> => number
 * ExtractFieldValueType<PasswordField> => HashedPassword (from resultExtension)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic utility type needs to accept any BaseFieldConfig
type ExtractFieldValueType<TField extends BaseFieldConfig<any>> = TField extends {
  resultExtension: { outputType: infer O }
}
  ? ParseTypeString<O & string>
  : TField extends { getTypeScriptType(): { type: infer T; optional: infer Opt } }
    ? Opt extends true
      ? ParseTypeString<T & string> | null | undefined
      : ParseTypeString<T & string>
    : unknown

/**
 * Extract field names as union of string literals
 *
 * @example
 * FieldKeys<{ title: TextField, content: TextField }> => 'title' | 'content'
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic utility type needs to accept any field record
export type FieldKeys<TFields extends Record<string, any>> = keyof TFields & string

/**
 * Get field config for a specific field name
 * Preserves the specific field type (TextField, PasswordField, etc.)
 *
 * @example
 * GetFieldConfig<{ title: TextField }, 'title'> => TextField
 */
export type GetFieldConfig<
  TFields extends Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- Generic utility type needs to accept any field record
  TFieldKey extends FieldKeys<TFields>,
> = TFields[TFieldKey]

/**
 * Get value type for a specific field
 *
 * @example
 * GetFieldValueType<{ title: TextField }, 'title'> => string
 */
export type GetFieldValueType<
  TFields extends Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- Generic utility type needs to accept any field record
  TFieldKey extends FieldKeys<TFields>,
> = ExtractFieldValueType<GetFieldConfig<TFields, TFieldKey>>

/**
 * TypeInfo interface for list type information
 * Provides a structured way to pass all type information for a list
 * Inspired by Keystone's TypeInfo pattern
 *
 * @template TKey - The list key/name (e.g., 'Post', 'User')
 * @template TFields - The fields configuration for the list
 * @template TItem - The output type (Prisma model type)
 * @template TCreateInput - The Prisma create input type
 * @template TUpdateInput - The Prisma update input type
 *
 * @example
 * ```typescript
 * type PostTypeInfo = {
 *   key: 'Post'
 *   fields: { title: TextField<...>, content: TextField<...> }
 *   item: Post
 *   inputs: {
 *     create: Prisma.PostCreateInput
 *     update: Prisma.PostUpdateInput
 *   }
 * }
 * ```
 */
export interface TypeInfo<
  TKey extends string = string,
  TFields extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- TypeInfo must accept any field record
> {
  key: TKey
  fields: TFields
  item: any // eslint-disable-line @typescript-eslint/no-explicit-any -- Item type is provided by Prisma and varies per list
  inputs: {
    create: any // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma input types are generated and vary per list
    update: any // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma input types are generated and vary per list
  }
}

// Generic `any` default allows OperationAccess to work with any list item type
// This is needed because the item type varies per list and is inferred from Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OperationAccess<T = any> = {
  query?: AccessControl<T>
  create?: AccessControl<T>
  update?: AccessControl<T>
  delete?: AccessControl<T>
}

/**
 * List-level access control configuration
 * Supports two patterns:
 *
 * 1. Function shorthand - applies to all CRUD operations:
 *    `access: isAdmin`
 *
 * 2. Object form - configure operations individually:
 *    `access: { operation: { query: () => true, create: isAdmin } }`
 *
 * @example Function shorthand
 * ```typescript
 * const isAdmin = ({ session }) => session?.role === 'admin'
 *
 * list({
 *   access: isAdmin,  // Applies to query, create, update, delete
 *   fields: { ... }
 * })
 * ```
 *
 * @example Object form
 * ```typescript
 * list({
 *   access: {
 *     operation: {
 *       query: () => true,
 *       create: isAdmin,
 *       update: isOwner,
 *       delete: isAdmin,
 *     }
 *   },
 *   fields: { ... }
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ListAccessControl<T = any> =
  | AccessControl<T>
  | {
      operation?: OperationAccess<T>
    }

/**
 * Hook arguments for resolveInput hook
 * Uses discriminated union to provide proper types based on operation
 * - create: resolvedData is CreateInput, item is undefined
 * - update: resolvedData is UpdateInput, item is the existing record
 */
export type ResolveInputHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      inputData: TCreateInput
      resolvedData: TCreateInput
      item: undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      inputData: TUpdateInput
      resolvedData: TUpdateInput
      item: TOutput
      context: import('../access/types.js').AccessContext
    }

/**
 * Hook arguments for validate hook (renamed from validateInput for Keystone compatibility)
 * Uses discriminated union to provide proper types based on operation
 * - create: resolvedData is CreateInput, item is undefined
 * - update: resolvedData is UpdateInput, item is the existing record
 * - delete: item is the item being deleted
 */
export type ValidateHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      inputData: TCreateInput
      resolvedData: TCreateInput
      item: undefined
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }
  | {
      listKey: string
      operation: 'update'
      inputData: TUpdateInput
      resolvedData: TUpdateInput
      item: TOutput
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }
  | {
      listKey: string
      operation: 'delete'
      item: TOutput
      context: import('../access/types.js').AccessContext
      addValidationError: (msg: string) => void
    }

/**
 * Hook arguments for beforeOperation hook
 * Uses discriminated union to provide proper types based on operation
 * - create: has inputData and resolvedData, no item
 * - update: has inputData, resolvedData, and item
 * - delete: has item only
 */
export type BeforeOperationHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      inputData: TCreateInput
      resolvedData: TCreateInput
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      inputData: TUpdateInput
      item: TOutput
      resolvedData: TUpdateInput
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'delete'
      item: TOutput
      context: import('../access/types.js').AccessContext
    }

/**
 * Hook arguments for afterOperation hook
 * Uses discriminated union to provide proper types based on operation
 * - create: has item, inputData, and resolvedData, no originalItem
 * - update: has item, originalItem, inputData, and resolvedData
 * - delete: has originalItem only
 */
export type AfterOperationHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      inputData: TCreateInput
      item: TOutput
      resolvedData: TCreateInput
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      inputData: TUpdateInput
      originalItem: TOutput
      item: TOutput
      resolvedData: TUpdateInput
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'delete'
      originalItem: TOutput
      context: import('../access/types.js').AccessContext
    }

export type Hooks<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> = {
  resolveInput?: (
    args: ResolveInputHookArgs<TOutput, TCreateInput, TUpdateInput>,
  ) => Promise<TCreateInput | TUpdateInput>
  validate?: (args: ValidateHookArgs<TOutput, TCreateInput, TUpdateInput>) => Promise<void>
  beforeOperation?: (
    args: BeforeOperationHookArgs<TOutput, TCreateInput, TUpdateInput>,
  ) => Promise<void>
  afterOperation?: (
    args: AfterOperationHookArgs<TOutput, TCreateInput, TUpdateInput>,
  ) => Promise<void>
  /**
   * @deprecated Use 'validate' instead. This alias is provided for backwards compatibility.
   */
  validateInput?: (args: ValidateHookArgs<TOutput, TCreateInput, TUpdateInput>) => Promise<void>
}

// Generic `any` default allows ListConfig to work with any list item type
// This is needed because the item type varies per list and is inferred from Prisma models
/**
 * Internal list configuration type (after normalization by list() function)
 * Access control is always in object form internally.
 * Use list() function which accepts both function shorthand and object form.
 */
export type ListConfig<TTypeInfo extends TypeInfo> = {
  // Field configs are automatically transformed to inject the full TypeInfo
  // This enables proper typing in field hooks where item, create input, and update input are all typed
  fields: FieldsWithTypeInfo<TTypeInfo>
  /**
   * Access control configuration for this list (normalized object form).
   * The list() function normalizes function shorthand to this object form.
   */
  access?: {
    operation?: OperationAccess<TTypeInfo['item']>
  }
  hooks?: Hooks<TTypeInfo['item'], TTypeInfo['inputs']['create'], TTypeInfo['inputs']['update']>
  /**
   * Database configuration for this list (model level)
   */
  db?: {
    /**
     * Custom database table name.
     * Adds a `@@map` attribute to the generated Prisma model.
     *
     * Useful when the Prisma model name (the list key) must differ from the
     * physical table name — e.g. adopting an existing better-auth installation
     * whose tables were created under a different name.
     *
     * @example
     * ```typescript
     * AuthUser: list({ fields: { ... }, db: { map: 'user' } })
     * // Generates: model AuthUser { ... @@map("user") }
     * ```
     */
    map?: string
    /**
     * Database schema for this model (Postgres multi-schema).
     * Adds a `@@schema` attribute to the generated Prisma model.
     *
     * Requires the schema to be listed in the datasource `schemas` array (see
     * {@link DatabaseConfig.schemas}) and the `multiSchema` preview feature,
     * both of which the generator emits automatically when `db.schemas` is set.
     *
     * Useful when adopting an existing installation whose tables live in a
     * non-`public` schema — e.g. a separate-schema better-auth layout.
     *
     * @example
     * ```typescript
     * AuthUser: list({ fields: { ... }, db: { schema: 'auth' } })
     * // Generates: model AuthUser { ... @@schema("auth") }
     * ```
     */
    schema?: string
    /**
     * Per-list override for auto-injected `createdAt`/`updatedAt` timestamp columns.
     *
     * Takes precedence over the global `db.timestamps` setting:
     * - `true` forces auto-timestamps on for this list, even when the global default is off.
     * - `false` forces them off for this list, even when enabled globally.
     * - `undefined` (the default) falls back to the global `db.timestamps` setting.
     *
     * When timestamps resolve to on but the list already declares its own `createdAt`/
     * `updatedAt` field, the auto column is skipped for the declared field(s) so Prisma
     * never sees a duplicate (`P1012`).
     *
     * @example Opt a single list out of timestamps even when enabled globally
     * ```typescript
     * Production: list({
     *   fields: { name: text() },
     *   db: { timestamps: false },
     * })
     * ```
     */
    timestamps?: boolean
  }
  /**
   * MCP server configuration for this list
   */
  mcp?: ListMcpConfig
  /**
   * Restricts this list to a single record (singleton pattern)
   * When true:
   * - Prevents creating multiple records
   * - Auto-creates the single record on first access (if autoCreate: true, which is the default)
   * - Provides a get() method for easy access to the singleton
   * - Blocks delete and findMany operations
   * - Changes UI to show edit form instead of list view
   *
   * @example Simple boolean (auto-create enabled)
   * ```typescript
   * isSingleton: true
   * ```
   *
   * @example With options
   * ```typescript
   * isSingleton: {
   *   autoCreate: false  // Don't auto-create, must be created manually
   * }
   * ```
   */
  isSingleton?:
    | boolean
    | {
        /**
         * Auto-create the singleton record on first access using field defaults
         * @default true
         */
        autoCreate?: boolean
      }
}

/**
 * Input type for the list() function
 * Accepts both function shorthand and object form for access control.
 */
export type ListConfigInput<TTypeInfo extends TypeInfo> = Omit<ListConfig<TTypeInfo>, 'access'> & {
  /**
   * Access control configuration for this list.
   * Supports both function shorthand and object form.
   *
   * @example Function shorthand (applies to all operations)
   * ```typescript
   * access: isAdmin
   * ```
   *
   * @example Object form (per-operation)
   * ```typescript
   * access: { operation: { query: () => true, create: isAdmin } }
   * ```
   */
  access?: ListAccessControl<TTypeInfo['item']>
}

/**
 * Database configuration
 */
export type DatabaseConfig = {
  provider: 'postgresql' | 'mysql' | 'sqlite'
  /**
   * Factory function to create a Prisma client instance with a database adapter
   * Required in Prisma 7+ - receives the PrismaClient class and returns a configured instance
   *
   * The connection URL is passed directly to the adapter, not to the config.
   *
   * @example SQLite with better-sqlite3
   * ```typescript
   * import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
   *
   * prismaClientConstructor: (PrismaClient) => {
   *   const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
   *   return new PrismaClient({ adapter })
   * }
   * ```
   *
   * @example PostgreSQL with pg
   * ```typescript
   * import { PrismaPg } from '@prisma/adapter-pg'
   * import pg from 'pg'
   *
   * prismaClientConstructor: (PrismaClient) => {
   *   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
   *   const adapter = new PrismaPg(pool)
   *   return new PrismaClient({ adapter })
   * }
   * ```
   *
   * @example Neon serverless (PostgreSQL)
   * ```typescript
   * import { PrismaNeon } from '@prisma/adapter-neon'
   * import { neonConfig } from '@neondatabase/serverless'
   * import ws from 'ws'
   *
   * prismaClientConstructor: (PrismaClient) => {
   *   neonConfig.webSocketConstructor = ws
   *   const adapter = new PrismaNeon({
   *     connectionString: process.env.DATABASE_URL
   *   })
   *   return new PrismaClient({ adapter })
   * }
   * ```
   */
  // Uses `any` for maximum flexibility with Prisma client constructors and adapters
  // Different database adapters have varying type signatures that are hard to unify
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClientConstructor: (PrismaClientClass: any) => any
  /**
   * Join table naming strategy for many-to-many relationships
   * - 'prisma': Use Prisma's default alphabetically-sorted naming (e.g., `_LessonToTeacher`)
   * - 'keystone': Use KeystoneJS-compatible naming based on field location (e.g., `_Lesson_teachers`)
   *
   * Default: 'prisma'
   *
   * **Important for KeystoneJS migration:**
   * When migrating from KeystoneJS, set this to 'keystone' to preserve existing join table names
   * and avoid data loss. Keystone names join tables as `_Model_fieldName` based on where the
   * relationship is defined in the schema.
   *
   * @example Preserve Keystone join table names during migration
   * ```typescript
   * db: {
   *   provider: 'postgresql',
   *   joinTableNaming: 'keystone',  // Use KeystoneJS naming convention
   *   // ... rest of config
   * }
   * ```
   */
  joinTableNaming?: 'prisma' | 'keystone'
  /**
   * Postgres multi-schema support.
   *
   * When set, the generator enables Prisma's `multiSchema` preview feature and
   * emits the `schemas = [...]` array on the datasource block. Combine with a
   * per-list `db.schema` (see {@link ListConfig}) to place models in a specific
   * schema via `@@schema(...)`.
   *
   * Only applies to the `postgresql` provider. When unset, the generated schema
   * is unchanged (single `public` schema, no `@@schema` attributes).
   *
   * @example Separate `auth` schema alongside the default `public`
   * ```typescript
   * db: {
   *   provider: 'postgresql',
   *   schemas: ['public', 'auth'],
   *   // ...
   * }
   * ```
   */
  schemas?: string[]
  /**
   * Auto-inject `createdAt`/`updatedAt` timestamp columns into every generated model.
   *
   * Default: `false`. The generator does NOT add timestamps automatically — a list
   * opts in either by declaring the fields itself or by enabling this flag. This matches
   * Keystone 6, which never adds timestamps automatically, and keeps Keystone → stack
   * migrations non-destructive (Schema parity). See ADR-0004.
   *
   * When `true`, every list receives:
   * ```prisma
   * createdAt DateTime @default(now())
   * updatedAt DateTime @default(now()) @updatedAt
   * ```
   *
   * A per-list `db.timestamps` override takes precedence over this global setting. When
   * timestamps are enabled but a list already declares its own `createdAt`/`updatedAt`
   * field, the auto column is skipped for the declared field(s) so Prisma never sees a
   * duplicate (`P1012`).
   *
   * @default false
   *
   * @example Re-enable auto-timestamps globally
   * ```typescript
   * db: {
   *   provider: 'postgresql',
   *   timestamps: true,
   *   // ... rest of config
   * }
   * ```
   */
  timestamps?: boolean
  /**
   * Opt into Keystone-compat mode for generated schema defaults.
   *
   * Keystone 6 gives every non-null text column an implicit empty-string
   * default. With `keystoneCompat: true`, the generator mirrors that: any
   * non-null `text()` column that has no explicit `defaultValue` emits
   * `@default("")`, so a migrating project reaches Schema parity without
   * hand-setting `defaultValue: ''` on dozens of columns.
   *
   * Stays opt-in (default `false`) because a greenfield project would not want
   * implicit empty-string text defaults cluttering its schema. The flag never
   * affects nullable text, fields with an explicit `defaultValue`, or any
   * non-text field — an explicit `text({ defaultValue: 'x' })` always wins.
   *
   * @default false
   *
   * @example Reach Schema parity when migrating from Keystone
   * ```typescript
   * db: {
   *   provider: 'postgresql',
   *   keystoneCompat: true, // non-null text without a default → @default("")
   *   // ... rest of config
   * }
   * ```
   *
   * @see ADR-0004 (Keystone-compatible generator defaults)
   */
  keystoneCompat?: boolean
  /**
   * Optional function to extend or modify the generated Prisma schema
   * Receives the generated schema as a string and should return the modified schema
   * Useful for advanced Prisma features not directly supported by the config API
   *
   * @example Add multi-schema support for PostgreSQL
   * ```typescript
   * extendPrismaSchema: (schema) => {
   *   // Add schemas array to datasource
   *   let modifiedSchema = schema
   *     .replace(
   *       /(datasource db \{[^}]+provider\s*=\s*"postgresql")/,
   *       '$1\n  schemas = ["public", "auth"]'
   *     )
   *
   *   // Add @@schema("public") to all models
   *   modifiedSchema = modifiedSchema.replace(
   *     /^(model \w+\s*\{[\s\S]*?)(^}$)/gm,
   *     (match, modelContent) => {
   *       if (!modelContent.includes('@@schema')) {
   *         return `${modelContent}\n  @@schema("public")\n}`
   *       }
   *       return match
   *     }
   *   )
   *
   *   return modifiedSchema
   * }
   * ```
   */
  extendPrismaSchema?: (schema: string) => string
}

/**
 * Session configuration
 */
export type SessionConfig = {
  // Uses `any` return type because session structure is user-defined and varies per application
  // The stack doesn't enforce a specific session shape - users can use NextAuth, Clerk, etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSession: () => Promise<any>
}

/**
 * Theme preset options
 */
export type ThemePreset = 'modern' | 'classic' | 'neon'

/**
 * Custom theme colors (HSL values without hsl() wrapper)
 * Format: "220 20% 97%" (hue saturation lightness)
 */
export type ThemeColors = {
  background?: string
  foreground?: string
  card?: string
  cardForeground?: string
  popover?: string
  popoverForeground?: string
  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  muted?: string
  mutedForeground?: string
  accent?: string
  accentForeground?: string
  destructive?: string
  destructiveForeground?: string
  border?: string
  input?: string
  ring?: string
  gradientFrom?: string
  gradientTo?: string
}

/**
 * Theme configuration
 */
export type ThemeConfig = {
  /**
   * Preset theme to use
   * @default "modern"
   */
  preset?: ThemePreset
  /**
   * Custom color overrides for light mode
   */
  colors?: ThemeColors
  /**
   * Custom color overrides for dark mode
   */
  darkColors?: ThemeColors
  /**
   * Border radius in rem
   * @default 0.75
   */
  radius?: number
}

/**
 * UI configuration
 */
export type UIConfig = {
  basePath?: string
  /**
   * Theme configuration for the admin UI
   */
  theme?: ThemeConfig
}

/**
 * MCP (Model Context Protocol) configuration
 */

/**
 * Configuration for which CRUD tools to enable for a list
 */
export type McpToolsConfig = {
  /**
   * Enable read/query tool
   * @default true
   */
  read?: boolean
  /**
   * Enable create tool
   * @default true
   */
  create?: boolean
  /**
   * Enable update tool
   * @default true
   */
  update?: boolean
  /**
   * Enable delete tool
   * @default true
   */
  delete?: boolean
}

/**
 * Custom MCP tool definition
 * Allows developers to add custom tools for specific lists
 */
export type McpCustomTool = {
  /**
   * Unique name for the tool
   */
  name: string
  /**
   * Description of what the tool does
   */
  description: string
  /**
   * Input schema (Zod schema)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any
  /**
   * Handler function that executes the tool
   */
  handler: (args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    context: import('../access/types.js').AccessContext
  }) => Promise<unknown>
}

/**
 * List-level MCP configuration
 */
export type ListMcpConfig = {
  /**
   * Enable MCP tools for this list
   * @default true
   */
  enabled?: boolean
  /**
   * Configure which CRUD tools to enable
   */
  tools?: McpToolsConfig
  /**
   * Custom tools specific to this list
   */
  customTools?: McpCustomTool[]
}

/**
 * OAuth configuration for MCP authentication
 * Supports Better Auth and custom auth providers
 */
export type McpAuthConfig =
  | {
      /**
       * Authentication type - Better Auth integration
       */
      type: 'better-auth'
      /**
       * Path to login page for OAuth flow
       */
      loginPage: string
      /**
       * OAuth scopes to request
       * @default ["openid", "profile", "email"]
       */
      scopes?: string[]
      /**
       * Optional OIDC configuration
       */
      oidcConfig?: {
        /**
         * Code expiration time in seconds
         * @default 600
         */
        codeExpiresIn?: number
        /**
         * Access token expiration time in seconds
         * @default 3600
         */
        accessTokenExpiresIn?: number
        /**
         * Refresh token expiration time in seconds
         * @default 604800
         */
        refreshTokenExpiresIn?: number
        /**
         * Default scope for OAuth requests
         * @default "openid"
         */
        defaultScope?: string
        /**
         * Additional scopes to support
         */
        scopes?: string[]
      }
    }
  | {
      /**
       * Authentication type - custom auth provider
       */
      type: string
      /**
       * Additional auth-specific configuration
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Allows custom auth provider configuration
      [key: string]: any
    }

/**
 * Global MCP server configuration
 */
export type McpConfig = {
  /**
   * Enable MCP server globally
   * @default false
   */
  enabled?: boolean
  /**
   * Base path for MCP API routes
   * @default "/api/mcp"
   */
  basePath?: string
  /**
   * Authentication configuration
   * Required when MCP is enabled
   */
  auth?: McpAuthConfig
  /**
   * Default tool configuration for all lists
   * Can be overridden per-list
   */
  defaultTools?: McpToolsConfig
  /**
   * Resource identifier for OAuth protected resource metadata
   * @default "https://yourdomain.com"
   */
  resource?: string
}

/**
 * Storage configuration for file uploads
 * Maps storage provider names to their configurations
 *
 * @example
 * ```typescript
 * storage: {
 *   avatars: s3Storage({ bucket: 'my-avatars', region: 'us-east-1' }),
 *   documents: localStorage({ uploadDir: './uploads', serveUrl: '/api/files' })
 * }
 * ```
 */
/**
 * File metadata stored in the database (as JSON)
 * Used by file upload fields to track uploaded files
 */
export interface FileMetadata {
  /** Generated filename in storage */
  filename: string
  /** Original filename from upload */
  originalFilename: string
  /** Public URL to access the file */
  url: string
  /** MIME type */
  mimeType: string
  /** File size in bytes */
  size: number
  /** Upload timestamp */
  uploadedAt: string
  /** Storage provider name */
  storageProvider: string
  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>
}

/**
 * Image-specific metadata (extends FileMetadata)
 * Includes dimensions and optional transformations
 */
export interface ImageMetadata extends FileMetadata {
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
  /** Generated image transformations/variants */
  transformations?: Record<string, ImageTransformationResult>
}

/**
 * Result of an image transformation
 */
export interface ImageTransformationResult {
  /** URL to the transformed image */
  url: string
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** File size in bytes */
  size: number
}

export type StorageConfig = Record<string, { type: string; [key: string]: unknown }>

/**
 * Plugin system types
 */

/**
 * Files generated by the core generators
 * Plugins can modify these during afterGenerate hooks
 */
export type GeneratedFiles = {
  prismaSchema: string
  types: string
  context: string
  [key: string]: string // Allow plugins to add custom generated files
}

/**
 * Context provided to plugins during initialization
 * Provides helpers for safely modifying config
 */
export type PluginContext = {
  /**
   * Current config state (read-only)
   * Plugins should use helper methods to modify config, not mutate directly
   */
  readonly config: OpenSaasConfig

  /**
   * Add a new list to the config
   * Throws error if list already exists (unless merge strategy used)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plugin API must accept any list config
  addList: (name: string, listConfig: ListConfig<any>) => void

  /**
   * Extend an existing list with additional fields, hooks, or access control
   * Deep merges fields, hooks, and access control
   * Throws error if list doesn't exist
   */
  extendList: (
    name: string,
    extension: {
      fields?: Record<string, FieldConfig>
      hooks?: Hooks
      access?: {
        operation?: OperationAccess
      }
      mcp?: ListMcpConfig
    },
  ) => void

  /**
   * Register a field type globally
   * Useful for third-party field packages
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plugin API must accept any field config builder
  registerFieldType?: (type: string, builder: (options?: unknown) => BaseFieldConfig<any>) => void

  /**
   * Register a custom MCP tool
   * Tools are added to the global MCP server
   */
  registerMcpTool?: (tool: McpCustomTool) => void

  /**
   * Store plugin-specific data in config for runtime access
   * Prefixed with plugin name to avoid conflicts
   */
  setPluginData: <T>(pluginName: string, data: T) => void
}

/**
 * Plugin definition
 * Plugins can extend config, inject lists, add hooks, and participate in generation lifecycle
 */
export type Plugin = {
  /**
   * Unique plugin name (used for dependency resolution and data storage)
   */
  name: string

  /**
   * Plugin version (semantic versioning)
   */
  version?: string

  /**
   * Dependencies on other plugins (by name)
   * Ensures plugins execute in correct order
   */
  dependencies?: string[]

  /**
   * Main initialization hook
   * Called during config processing to extend or modify configuration
   */
  init: (context: PluginContext) => void | Promise<void>

  /**
   * Optional: Modify config before Prisma schema generation
   * Useful for programmatic config transformations
   */
  beforeGenerate?: (config: OpenSaasConfig) => OpenSaasConfig | Promise<OpenSaasConfig>

  /**
   * Optional: Post-process generated files
   * Allows plugins to modify Prisma schema, types, or add custom generated files
   */
  afterGenerate?: (files: GeneratedFiles) => GeneratedFiles | Promise<GeneratedFiles>

  /**
   * Optional: Provide runtime services
   * Called when creating context to provide plugin-specific services
   * Return value is stored in context.plugins[pluginName]
   */
  runtime?: (context: import('../access/types.js').AccessContext) => unknown

  /**
   * Optional: Type metadata for runtime services
   * Enables type-safe code generation for context.plugins
   *
   * @example
   * ```typescript
   * {
   *   import: "import type { AuthRuntimeServices } from '@opensaas/stack-auth/runtime'",
   *   typeName: "AuthRuntimeServices"
   * }
   * ```
   */
  runtimeServiceTypes?: {
    /**
     * Import statement to include in generated types file
     * Must be a complete import statement with 'import type' and quotes
     */
    import: string
    /**
     * TypeScript type name to use in PluginServices interface
     * Should match the exported type from the import
     */
    typeName: string
  }
}

/**
 * Main configuration type
 * Using interface instead of type to allow module augmentation
 */
/**
 * Configurable generator output locations.
 *
 * Lets a project relocate the generated Prisma schema and the `.opensaas`
 * bundle directory. Paths are interpreted relative to the project root.
 *
 * @example
 * ```typescript
 * output: {
 *   prismaSchema: 'prisma-opensaas/schema.prisma',
 *   opensaasDir: '.opensaas',
 * }
 * ```
 */
export interface OutputConfig {
  /**
   * Path to the generated Prisma schema file.
   * @default "prisma/schema.prisma"
   */
  prismaSchema?: string
  /**
   * Directory for the generated `.opensaas` bundle (types, lists, context,
   * plugin-types, prisma-extensions, and the patched Prisma client).
   * @default ".opensaas"
   */
  opensaasDir?: string
}

export interface OpenSaasConfig {
  db: DatabaseConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Config must accept any list configuration
  lists: Record<string, ListConfig<any>>
  session?: SessionConfig
  ui?: UIConfig
  /**
   * MCP (Model Context Protocol) server configuration
   */
  mcp?: McpConfig
  /**
   * Storage configuration for file/image uploads
   * Maps named storage providers to their configurations
   */
  storage?: StorageConfig
  /**
   * Path where OpenSaas generates files (context, types, patched Prisma client)
   * @default ".opensaas"
   */
  opensaasPath?: string
  /**
   * Relocate the generator's output so `opensaas generate` can coexist with an
   * existing `prisma/` directory (e.g. during a Keystone → stack migration).
   *
   * Both fields are resolved relative to the project root (the directory the
   * CLI runs in). When omitted, defaults are unchanged: the schema is written to
   * `prisma/schema.prisma` and the `.opensaas` bundle to `.opensaas/`.
   *
   * The generated files' cross-references follow these locations — `context.ts`
   * imports the generated types/lists from the resolved `.opensaas` dir, and the
   * top-level `prisma.config.ts` points at the configured schema path so the
   * `prisma` CLI keeps working.
   */
  output?: OutputConfig
  /**
   * Plugins to extend the stack
   * Executed in array order (or dependency order if dependencies specified)
   */
  plugins?: Plugin[]
  /**
   * Plugin-specific data storage
   * Keyed by plugin name, used for runtime configuration
   * @internal
   */
  _pluginData?: Record<string, unknown>
  /**
   * Sorted plugin instances (stored after plugin execution)
   * Used at runtime to call plugin.runtime() functions
   * @internal
   */
  _plugins?: Plugin[]
}
