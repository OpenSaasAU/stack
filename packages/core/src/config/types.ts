import type { AccessControl, FieldAccess } from '../access/types.js'
import type { FilterSpec } from '../filter/types.js'
import type { z } from 'zod'

export type FieldType =
  'text' | 'integer' | 'checkbox' | 'timestamp' | 'password' | 'select' | 'relationship' | string // Allow custom field types from third-party packages

/**
 * Field-level hook argument types (exported for user annotations)
 */

/** Arguments for {@link FieldHooks.resolveInput}. */
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

/** Arguments for {@link FieldHooks.validate} (and its deprecated `validateInput` alias). */
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

/** Arguments for {@link FieldHooks.beforeOperation}. */
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

/** Arguments for {@link FieldHooks.afterOperation}. */
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
 * Arguments for field-level beforeTransaction hook (#590 / ADR-0010).
 *
 * Transaction-boundary hooks run OUTSIDE the write's database transaction.
 * `beforeTransaction` runs before the transaction opens, so it has the input
 * data but no persisted `item` yet (and, for create, no `item` to read). For
 * update/delete the existing `item` is best-effort: present for the top-level
 * target (which the pipeline resolves before opening the transaction) and
 * `undefined` for nested targets (not resolved at the boundary to avoid
 * pre-transaction reads). Use it for non-transactional side effects (e.g.
 * external API calls) whose compensation pairs with `afterTransaction`.
 */
export type FieldBeforeTransactionHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      inputData: TTypeInfo['inputs']['create']
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      inputData: TTypeInfo['inputs']['update']
      item: TTypeInfo['item'] | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      item: TTypeInfo['item'] | undefined
      context: import('../access/types.js').AccessContext
    }

/**
 * Arguments for field-level afterTransaction hook (#590 / ADR-0010).
 *
 * Runs AFTER the transaction settles and ALWAYS runs when its paired
 * `beforeTransaction` ran (symmetric bracket). The `status` discriminant tells
 * the hook whether the write committed or rolled back:
 *  - `committed`: the persisted `item`/`originalItem` are populated ONLY for the
 *    TOP-LEVEL record of the write. For NESTED lists they are `undefined` — the
 *    per-record persisted row is not reliably recoverable outside the
 *    transaction, and these hooks fire at per-(list, operation) granularity, not
 *    per record. For per-record nested compensation use the in-transaction
 *    `afterOperation` (which receives the correct nested `item`).
 *  - `rolled-back`: NO persisted `item`; the hook gets `inputData` and the
 *    `error` that caused the rollback so it can compensate for whatever
 *    `beforeTransaction` did externally.
 */
export type FieldAfterTransactionHookArgs<
  TTypeInfo extends TypeInfo,
  TFieldKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> =
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      status: 'committed'
      inputData: TTypeInfo['inputs']['create']
      /** Persisted row — populated for the top-level list only; `undefined` for nested lists. */
      item: TTypeInfo['item'] | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'create'
      status: 'rolled-back'
      inputData: TTypeInfo['inputs']['create']
      error: unknown
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      status: 'committed'
      inputData: TTypeInfo['inputs']['update']
      /** Pre-write row — populated for the top-level list only; `undefined` for nested lists. */
      originalItem: TTypeInfo['item'] | undefined
      /** Persisted row — populated for the top-level list only; `undefined` for nested lists. */
      item: TTypeInfo['item'] | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'update'
      status: 'rolled-back'
      inputData: TTypeInfo['inputs']['update']
      originalItem: TTypeInfo['item'] | undefined
      error: unknown
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      status: 'committed'
      /** Pre-write row — populated for the top-level list only; `undefined` for nested lists. */
      originalItem: TTypeInfo['item'] | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      fieldKey: TFieldKey
      operation: 'delete'
      status: 'rolled-back'
      originalItem: TTypeInfo['item'] | undefined
      error: unknown
      context: import('../access/types.js').AccessContext
    }

/** Arguments for {@link FieldHooks.resolveOutput}. */
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
   * Perform side effects BEFORE the write's database transaction opens
   * (#590 / ADR-0010 transaction-boundary hook).
   *
   * Unlike `beforeOperation` (which runs INSIDE the transaction and rolls back
   * with it), this runs OUTSIDE the transaction — use it for non-transactional
   * side effects such as external API calls that must not hold a DB transaction
   * open and cannot be rolled back. If this throws, the write is aborted (the
   * transaction never opens) and the paired `afterTransaction` fires with
   * `status: 'rolled-back'`.
   *
   * @example
   * ```typescript
   * beforeTransaction: async ({ operation, inputData }) => {
   *   await externalApi.reserve(inputData.externalId)
   * }
   * ```
   */
  beforeTransaction?: (
    args: FieldBeforeTransactionHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void

  /**
   * Perform side effects AFTER the write's database transaction settles
   * (#590 / ADR-0010 transaction-boundary hook).
   *
   * ALWAYS runs when the paired `beforeTransaction` ran (symmetric bracket),
   * receiving `status: 'committed' | 'rolled-back'`. On `committed` it gets the
   * persisted `item` ONLY for the top-level record (`undefined` for nested
   * lists — use the in-transaction `afterOperation` for per-record nested
   * compensation); on `rolled-back` it gets the `error` that caused the
   * rollback and NO `item`, so it can compensate for whatever `beforeTransaction`
   * did externally.
   *
   * @example
   * ```typescript
   * afterTransaction: async (args) => {
   *   if (args.status === 'rolled-back') {
   *     await externalApi.release(args.inputData.externalId)
   *   }
   * }
   * ```
   */
  afterTransaction?: (
    args: FieldAfterTransactionHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void

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
   * Marks this field as virtual — not stored in database, computed via
   * `resolveInput`/`resolveOutput` hooks, and excluded from the Prisma
   * schema and input types. Computed whenever the read is going to return
   * it (ADR-0027) — not gated behind an explicit `include`/selection.
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
     * Help / description text rendered beneath the field control in the admin UI.
     *
     * `FieldRenderer` surfaces this to the rendered field component as its
     * `helpText` prop, so it appears via the shared field-shell `FieldHelp`
     * rhythm (data-slot="field-help") for admin-rendered fields.
     *
     * @example
     * ```typescript
     * fields: {
     *   slug: text({ ui: { description: 'URL-friendly identifier, lowercase only.' } })
     * }
     * ```
     */
    description?: string
    /**
     * Whether this field belongs in a list/related-list table's DEFAULT
     * column set (issue #1018) — the columns shown when nothing explicitly
     * names them (`ui.listView.initialColumns` on the list, or a
     * relationship's own `ui.itemView.columns`). Naming the field explicitly
     * in either of those always shows it regardless of this flag; it governs
     * only what appears absent an explicit column list.
     *
     * This is a PRESENTATION default, not an access control — a field can be
     * read-denied and still default to `true` here (it simply renders empty
     * for a viewer who can't read it), and setting this to `false` hides a
     * column without restricting who can read the underlying value. The
     * field-level `access.read` deny remains the only real boundary.
     *
     * @default true
     *
     * @example Hide an internal field from default table views without denying read access
     * ```typescript
     * fields: {
     *   internalScore: integer({ ui: { listView: { defaultColumn: false } } }),
     * }
     * ```
     */
    listView?: {
      defaultColumn?: boolean
    }
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
   * @returns Prisma type string, optional modifiers, optional enum values, and
   *   an optional block-level index request
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
    /**
     * If set, this field requires a block-level index on the owning model:
     * `@@index([fieldName])` for `true`, `@@unique([fieldName])` for
     * `'unique'`. `false` and `undefined` both mean "no index".
     *
     * Prisma has no field-level `@index` attribute — a non-unique index can
     * ONLY be expressed as the model-level `@@index([...])` — so a field that
     * wants one has to ask for it out-of-line rather than appending to
     * {@link modifiers}. (A unique index has both forms available; the
     * built-in scalars keep emitting the inline `@unique` modifier for that
     * case, so this channel carries only what cannot be written inline.)
     *
     * Same shape as {@link PrismaRelationResult.foreignKeyIndex}, which is how
     * relationship fields have always emitted their foreign-key indexes. The
     * generator handles both through one emit pass, so the field stays the
     * authority on whether it can be indexed by name at all — a multi-column
     * field (see {@link getPrismaColumns}) has no single column matching its
     * field name and can decline, or name a real column of its own.
     */
    index?: boolean | 'unique'
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
   * Declare this field's filtering capability — its {@link FilterSpec} — for the
   * admin UI's Filter builder (ADR-0017). Optional and additive: a field that
   * omits it (like `password`, `json`, `virtual`, or a third-party field that
   * hasn't adopted filtering) is simply not filterable and never suggested, so
   * absence degrades gracefully everywhere.
   *
   * Self-contained, like {@link getPrismaType} and friends — the filter engine
   * delegates to each field's spec rather than switching on field type. The
   * returned `toCondition` mapper must stay pure (no DB/Prisma imports); its
   * output is ANDed with the access filter through the secured context.
   *
   * @param fieldName The field's config key (closed over by the mapper).
   * @param listKey   The owning list's key.
   * @param config    The full config (e.g. relationship specs resolve their
   *   target list's label field from it).
   * @returns The field's Filter spec, or `undefined` when not filterable.
   */
  getFilterSpec?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => FilterSpec | undefined
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
  /**
   * Multi-column Prisma emission.
   *
   * Most scalar fields back a single Prisma column via {@link getPrismaType}.
   * A field that maps onto SEVERAL physical columns (e.g. the storage
   * `image()`/`file()` fields in multi-column / Keystone-parity mode — see
   * ADR-0006) implements this instead: it returns one descriptor per column,
   * each becoming its own line in the generated model. When present, the
   * generator emits these lines and skips the single-column `getPrismaType`
   * path. The field itself owns the column layout — the generator stays a
   * neutral coordinator (no field-type switches), mirroring how relationship
   * fields emit FK + relation lines through `getPrismaRelation`.
   *
   * @param fieldName - The field's config key (used to derive default column names)
   * @returns One descriptor per physical column, or `undefined` to fall back to
   *   the single-column `getPrismaType` path.
   */
  getPrismaColumns?: (fieldName: string) => MultiColumnPrismaResult[] | undefined
  /**
   * The physical Prisma column names this field owns when it spans multiple
   * columns (see {@link getPrismaColumns}). The read path uses this to strip the
   * raw per-part columns from query results so only the assembled logical value
   * (produced by {@link assembleColumns}) is exposed.
   *
   * @param fieldName - The field's config key
   */
  getColumnNames?: (fieldName: string) => string[]
  /**
   * Assemble the field's logical value from a database row's per-part columns
   * (the read direction of a multi-column field). Pure transform — called by the
   * read pipeline before field visibility. Receives the full row so it can read
   * its sibling columns by name.
   *
   * @param fieldName - The field's config key
   * @param row - The raw database row (contains the per-part columns)
   */
  assembleColumns?: (fieldName: string, row: Record<string, unknown>) => unknown
  /**
   * Split the field's logical value into per-part columns for writing (the write
   * direction of a multi-column field). Pure transform — called by the write
   * pipeline after `resolveInput`; the returned record is merged into the write
   * payload in place of the single field key.
   *
   * @param fieldName - The field's config key
   * @param value - The resolved logical value (metadata, or `null` to clear)
   */
  splitColumns?: (fieldName: string, value: unknown) => Record<string, unknown>
  /**
   * Describe what this field contributes to the contract (ADR-0040,
   * ADR-0049): its stored column(s) as a pack-qualified type constructor with
   * native type, nullability and column mapping; for a relationship, the
   * relation and the foreign-key column this side owns; for a virtual field,
   * nothing. Core's contract derivation reads this — never the PSL-shaped
   * `getPrismaType`/`getPrismaColumns`/`getPrismaRelation`, which it replaces.
   *
   * @param fieldName - The field's config key
   * @param listKey - The owning list's key
   * @param config - The full config (a relationship resolves its target and
   *   foreign-key ownership from it)
   *
   * @example
   * ```typescript
   * getContractField: (fieldName) => ({
   *   kind: 'column',
   *   name: fieldName,
   *   type: { pack: 'pgvector', type: 'Vector', args: [1536] },
   *   nullable: true,
   * })
   * ```
   */
  getContractField?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => ContractFieldDescriptor
  /**
   * The TypeScript type a read returns for this field, when it differs from
   * the column's codec type (ADR-0052). Required on a virtual field, where it
   * is the contract remainder's computed entry; on a stored field it is an
   * override — `password` reads as `HashedPassword` over a text column —
   * and absence means the codec's own type.
   *
   * @example "import('@opensaas/stack-core/internal').HashedPassword"
   * @example { value: Decimal, from: 'decimal.js' }
   */
  outputType?: TypeDescriptor
  /**
   * The TypeScript type a write accepts for this field, when it differs from
   * the column's codec input type (ADR-0052) — `calendarDay` accepts a
   * `YYYY-MM-DD` string where the codec would take more. Absence means the
   * codec's own input type.
   */
  inputType?: TypeDescriptor
  /**
   * Declares the immediate sibling columns and relations this field's
   * `resolveOutput` hook cannot compute without (ADR-0025, widened to columns
   * by ADR-0051 — the "Declared dependency" glossary entry in `CONTEXT.md`).
   * The read fetches each declared dependency wherever this field is
   * computed — at the root of a read and at every nested level alike — and
   * scopes a relation through the Access Filter exactly like a caller-named
   * one: a dependency a session cannot query is not fetched, and the hook
   * sees nothing in its place.
   *
   * A declared dependency is private plumbing, not an implicit `include`: it
   * is stripped from the result unless the caller named it too, so declaring
   * or removing one changes this field's implementation, never the shape of
   * every read of the list.
   *
   * Names stored columns and immediate relations on the same list only — no
   * dotted paths, and never a computed field. A declaration on a field with
   * no `resolveOutput` hook is dead config and fails `pnpm generate`.
   *
   * Typed as a plain `string[]`, not narrowed to this list's own relation
   * keys: `BaseFieldConfig` is the contextual type EVERY field builder's
   * return type is checked against, including non-generic third-party ones
   * (`richText(): RichTextField`, with no `TTypeInfo` parameter of its own —
   * the documented third-party field pattern). Narrowing `needs` per-list
   * would make `needs`'s type on a fixed, unparameterized third-party field
   * config disagree with the narrower type this list's own slot expects,
   * breaking assignability for every such field regardless of whether it
   * uses `needs` at all. A misspelled or non-relation entry is instead
   * caught by `pnpm generate` (`validateNeedsDeclarations`), which has no
   * such constraint.
   *
   * @example
   * ```typescript
   * lineItems: relationship({ ref: 'LineItem.order', many: true }),
   * total: virtual({
   *   type: 'number',
   *   needs: ['lineItems'],
   *   hooks: {
   *     resolveOutput: ({ item }) => item.lineItems.reduce((sum, li) => sum + li.price, 0),
   *   },
   * }),
   * ```
   */
  needs?: string[]
}

/**
 * A single physical column contributed by a multi-column field
 * (see {@link BaseFieldConfig.getPrismaColumns}).
 */
export type MultiColumnPrismaResult = {
  /** The Prisma model field name (the property the column is declared as). */
  name: string
  /** The Prisma scalar type, e.g. `'String'` or `'Int'`. */
  type: string
  /**
   * Field modifiers, e.g. `'?'` for nullable. A leading `'?'` attaches to the
   * type; anything after it is treated as trailing attributes (matching the
   * single-column `getPrismaType` modifier convention).
   */
  modifiers?: string
  /** Physical column name for the `@map` attribute, when it differs from `name`. */
  map?: string
}

/**
 * A JSON-serialisable literal. What a column default can hold, and the
 * argument vocabulary of a {@link ColumnTypeDescriptor} — the Contract module
 * is fully literal (ADR-0040), so nothing that cannot be re-emitted as source
 * belongs here.
 */
export type ContractLiteral =
  string | number | boolean | null | ContractLiteral[] | { [key: string]: ContractLiteral }

/**
 * A column's type as a pack-qualified type constructor —
 * `type.<pack>.<type>(...args)` in the Contract module (ADR-0049). Core's
 * scalars live in the `pg` pack (`{ pack: 'pg', type: 'text' }`,
 * `{ pack: 'pg', type: 'decimal', args: [18, 4] }`); a field over an extension
 * pack names it (`{ pack: 'pgvector', type: 'Vector', args: [1536] }`), and the
 * generator refuses a config that uses a pack `db.extensions` does not declare.
 */
export type ColumnTypeDescriptor = {
  /** The pack that owns the type constructor — `'pg'` for core's scalars, else an extension pack's `name`. */
  pack: string
  /** The type constructor's name within the pack. */
  type: string
  /** Positional arguments to the constructor (a length, a precision/scale pair, a dimension). */
  args?: ContractLiteral[]
}

/**
 * A column's default. `'literal'` carries a value the Contract module emits as
 * source; `'now'` is the database clock at insert.
 */
export type ColumnDefaultDescriptor = { kind: 'literal'; value: ContractLiteral } | { kind: 'now' }

/**
 * One stored column a field contributes to the contract.
 */
export type ContractColumnDescriptor = {
  /** The model field name — the property the column is declared as. Equals the field key for a single-column field. */
  name: string
  /** The column's type constructor. */
  type: ColumnTypeDescriptor
  /** A native-type override for the column (`db.nativeType`), when the constructor's default is not wanted. */
  nativeType?: string
  /** Whether the column accepts NULL. */
  nullable: boolean
  /** The physical column name, when it differs from {@link name} (`db.map`). */
  map?: string
  /** Whether the column carries a unique constraint (`isIndexed: 'unique'`). */
  unique?: boolean
  /** Whether the column carries a non-unique index (`isIndexed: true`). */
  index?: boolean
  /** The column's default, when it has one. */
  default?: ColumnDefaultDescriptor
  /**
   * The native enum this column is typed by, when {@link type} is an enum
   * constructor — the contract declares the enum entity once and the column
   * references it.
   */
  enum?: { name: string; values: string[] }
}

/**
 * The foreign-key column a relationship's owning side contributes. Its type
 * is not described here: it follows the id of the list it references, which
 * the derivation resolves from that list's own `db.idField`.
 */
export type ContractForeignKeyDescriptor = {
  /** The model field name of the foreign-key column (`<field>Id`). */
  name: string
  /** The physical column name, when it differs from {@link name}. */
  map?: string
  /** Whether the column accepts NULL (`db.isNullable`, default `true`). */
  nullable: boolean
  /** Whether the column carries a unique constraint — the owning side of a one-to-one. */
  unique: boolean
  /** Whether the column carries a non-unique index (`isIndexed`, default `true`). */
  index: boolean
  /** The list and field the column references. */
  references: { list: string; field: 'id' }
}

/**
 * A relationship field's contract contribution: the relation itself and, on
 * the owning side of a to-one, its foreign-key column.
 */
export type ContractRelationDescriptor = {
  kind: 'relation'
  /** The list this field points at. */
  target: string
  /**
   * The field on {@link target} that is this relation's other side. Declared
   * (`ref: 'List.field'`) or, for a list-only `ref: 'List'`, synthesised as
   * `from_<List>_<field>` on the target.
   */
  inverse: { field: string; synthetic: boolean }
  /** Whether this side holds many rows. */
  many: boolean
  /**
   * The foreign-key column this side owns. Absent on a to-many side and on
   * the non-owning side of a one-to-one, which have no column.
   */
  foreignKey?: ContractForeignKeyDescriptor
}

/**
 * What a field contributes to the contract (ADR-0040, ADR-0049):
 *
 * - `'column'` — one stored column; the common scalar case.
 * - `'columns'` — several stored columns owned by one field (the multi-column
 *   path ADR-0006 gave storage fields; each entry is its own column).
 * - `'relation'` — a relation and, when this side owns it, a foreign key.
 * - `'computed'` — no storage at all; a virtual field. Its TypeScript face is
 *   {@link BaseFieldConfig.outputType}, the contract remainder's computed entry.
 */
export type ContractFieldDescriptor =
  | ({ kind: 'column' } & ContractColumnDescriptor)
  | { kind: 'columns'; columns: ContractColumnDescriptor[] }
  | ContractRelationDescriptor
  | { kind: 'computed' }

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
  isIndexed?: boolean | 'unique'
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

/**
 * 64-bit integer field (Prisma `BigInt`, TypeScript `bigint`) — for values that
 * overflow `integer()`'s 32-bit `Int` (e.g. a millisecond epoch).
 *
 * Wire representation (ADR-0029): `bigint` in application code, a decimal
 * string over MCP — `bigint` is not JSON-serialisable, so the MCP handler
 * renders it as a string rather than throwing.
 */
export type BigIntField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'bigInt'
  defaultValue?: bigint | number | string
  validation?: {
    isRequired?: boolean
    min?: bigint
    max?: bigint
  }
  isIndexed?: boolean | 'unique'
}

export type CheckboxField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'checkbox'
}

export type TimestampField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'timestamp'
  defaultValue?: { kind: 'now' } | Date
  isIndexed?: boolean | 'unique'
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

/**
 * Badge-variant vocabulary a select option can map its value to for status-Cell
 * rendering in the admin UI (issue #729). Mirrors the admin UI Badge primitive's
 * variants; `secondary` is the neutral fallback used for unmapped options.
 */
export type SelectOptionVariant =
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'

/**
 * A single choice in a `select` field.
 *
 * `label`/`value` are the long-standing shape; `ui` is additive, optional
 * metadata (issue #729). `ui.variant` lets a value render as a coloured status
 * badge in list-table Cells — an option without it renders with the neutral
 * badge, so existing options keep working unchanged.
 */
export type SelectOption = {
  label: string
  value: string
  ui?: {
    /** Badge variant used when this option's value renders as a status Cell. */
    variant?: SelectOptionVariant
  }
}

export type SelectField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'select'
  options: Array<SelectOption>
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
    /**
     * Force the generated column to be nullable (`?`) even when a `defaultValue`
     * is present. By default a select with a `defaultValue` generates NOT NULL;
     * set this to `true` for an explicit opt-in to a nullable column with a
     * default (e.g. `String? @default("X")` or `<Enum>? @default(X)`), so that
     * a live column containing NULLs migrates without a NOT NULL failure.
     *
     * @default undefined (NOT NULL when a default is present — unchanged behaviour)
     *
     * @example
     * ```typescript
     * // Optional select with a default, but keep the column nullable
     * status: select({
     *   options: [{ label: 'Draft', value: 'draft' }],
     *   defaultValue: 'draft',
     *   db: { isNullable: true },
     * })
     * // Generates: String? @default("draft")
     * ```
     */
    isNullable?: boolean
    /**
     * Override the generated Prisma enum type name for native-enum selects
     * (only applies when `type: 'enum'`). By default the enum is named
     * `<List><Field>` (e.g. `AccountNoteStatus`); set this to match a live DB
     * enum type whose name differs (e.g. Keystone's `…Type` suffix).
     *
     * The custom name is applied to both the generated `enum` block and every
     * reference to it in the owning model.
     *
     * @example
     * ```typescript
     * status: select({
     *   options: [{ label: 'Open', value: 'open' }],
     *   db: { type: 'enum', enumName: 'AccountNoteStatusType' },
     * })
     * // Generates: enum AccountNoteStatusType { ... } and the column references it
     * ```
     */
    enumName?: string
  }
  validation?: {
    isRequired?: boolean
  }
  isIndexed?: boolean | 'unique'
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
  }
}

/**
 * Item-view configuration for a single to-many relationship field — the
 * per-relationship overrides for the admin item view's Relationship table
 * (issue #734). All values are plain, serialisable data so they can cross the
 * server→client boundary via the existing field-config serialisation.
 */
export type RelationshipItemViewConfig = {
  /**
   * How this to-many relationship is presented on the owning record's item
   * view:
   * - `'table'` (default): a read-only Relationship table of related rows.
   * - `'picker'`: demote it back to the compact relationship picker inside the
   *   details card (the pre-#734 behaviour).
   *
   * @default 'table'
   */
  displayMode?: 'table' | 'picker'
  /**
   * The related list's fields to show as Relationship-table columns, in order.
   *
   * When omitted, the columns default to the related list's own column
   * curation (`ui.listView.initialColumns`, else every field whose own
   * `ui.listView.defaultColumn` declaration holds — see {@link
   * BaseFieldConfig.ui}) minus the back-reference field that points at the
   * parent record.
   *
   * @example
   * ```typescript
   * posts: relationship({
   *   ref: 'Post.author',
   *   many: true,
   *   ui: { itemView: { columns: ['title', 'status'] } },
   * })
   * ```
   */
  columns?: string[]
  /**
   * The maximum number of related rows to fetch and render in this
   * Relationship table (issue #752). The item view fetches related rows
   * through the secured context bounded by this `take`, so a record with many
   * related rows never loads/renders every one on edit-page open. The totals
   * footer still shows the full access-scoped total ("showing N of M").
   *
   * When omitted, a sensible default cap applies (the UI's
   * `DEFAULT_ITEM_VIEW_TAKE`). Must be a positive integer; non-positive or
   * non-integer values fall back to the default.
   *
   * @example
   * ```typescript
   * sessions: relationship({
   *   ref: 'Session.user',
   *   many: true,
   *   ui: { itemView: { take: 5 } },
   * })
   * ```
   */
  take?: number
  /**
   * The numeric columns whose values are summed in the Relationship table's
   * totals footer. The row count is always shown; sums appear only for the
   * columns listed here, each formatted by that column's Cell.
   *
   * @example
   * ```typescript
   * lineItems: relationship({
   *   ref: 'LineItem.order',
   *   many: true,
   *   ui: { itemView: { sum: ['amount'] } },
   * })
   * ```
   */
  sum?: string[]
  /**
   * How a row's ✕ control removes a related row from this table (ADR-0018).
   *
   * - `'disconnect'` (default): non-destructively unlinks the related row from
   *   this record — the row itself is untouched and still appears on its own
   *   list. Gated on the related list's update access. Hidden statically when
   *   the schema makes disconnect impossible (a required foreign key on the
   *   related side, i.e. the back-reference declares `db.isNullable: false`).
   * - `'delete'`: opts into truly deleting the related row, behind a
   *   confirmation, gated on the related list's delete access.
   * - `'none'`: hides the removal control entirely.
   *
   * @default 'disconnect'
   */
  removeAction?: 'disconnect' | 'delete' | 'none'
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
       * Controls DB-level nullability of the foreign key column (and its
       * relation field) independently of the many side's own shape. Only
       * meaningful on the FK-owning (single) side of a relationship — the
       * many side has no column of its own to make non-nullable and rejects
       * this option.
       *
       * @default true (nullable, matching every relationship generated before
       * this option existed)
       *
       * @example
       * ```typescript
       * // Every session genuinely belongs to a user — make the FK required
       * user: relationship({
       *   ref: 'User.sessions',
       *   db: { isNullable: false },
       * })
       * // Generates: userId String  (was String?)
       * //            user   User    @relation(...)  (was User?)
       * ```
       */
      isNullable?: boolean
      /**
       * Controls foreign key placement and column name.
       * Can be a boolean or an object with a map property.
       * Only valid on single (non-many) relationships.
       * Cannot be true on both sides of a one-to-one relationship.
       *
       * The boolean form (the "which side owns the foreign key" sense) is only
       * meaningful on a bidirectional ref (`ref: 'ListName.fieldName'`) — a
       * list-only ref (`ref: 'ListName'`) always owns the foreign key, so a
       * boolean here is rejected. The `{ map }` form (the column-name sense)
       * works on both: it renames the foreign key column without changing
       * ownership.
       *
       * When a boolean, defaults the foreign key column name to the field name.
       * When an object with map, uses the provided column name.
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
       *
       * // List-only ref: rename the foreign key column (ownership is implicit)
       * Post: list({
       *   fields: {
       *     category: relationship({ ref: 'Category', db: { foreignKey: { map: 'category_id' } } })
       *     // Generates: categoryId String? @map("category_id")
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
      /**
       * Item-view (Relationship table) overrides for this to-many relationship
       * — columns, summed columns, and demotion to the compact picker (issue
       * #734). Ignored for single (`many: false`) relationships, which always
       * render inside the details card.
       */
      itemView?: RelationshipItemViewConfig
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
   * The Prisma-level foreign key field name this side owns (e.g. `authorId`),
   * regardless of whether it is indexed. `undefined` when this side doesn't
   * own a foreign key column at all (the many side, or the non-FK side of a
   * one-to-one). Lets other generator passes resolve a relationship field
   * name to its physical column — e.g. a model-level composite index
   * ({@link ListIndex}) naming a relationship field — without duplicating
   * {@link foreignKeyIndex}'s narrower, indexing-conditional presence.
   */
  foreignKeyField?: string
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

type WithTypeInfo<TTypeInfo extends TypeInfo> = BaseFieldConfig<TTypeInfo>

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
 * Extract field value type from a field config, in order of authority: the
 * field's `outputType` descriptor, then `resultExtension.outputType`, then
 * `getTypeScriptType()`.
 *
 * @example
 * ExtractFieldValueType<TextField> => string | null | undefined (if optional)
 * ExtractFieldValueType<IntegerField> => number
 * ExtractFieldValueType<PasswordField> => HashedPassword (from outputType)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic utility type needs to accept any BaseFieldConfig
type ExtractFieldValueType<TField extends BaseFieldConfig<any>> = TField extends {
  outputType: infer O extends string
}
  ? ParseTypeString<O>
  : TField extends {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mirrors TypeDescriptor's constructor signature
        outputType: { value: new (...args: any[]) => infer I }
      }
    ? I
    : TField extends { resultExtension: { outputType: infer O } }
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
  /**
   * Shares `AccessControl`'s signature (so a filter still type-checks here),
   * but at runtime `create` accepts a `boolean` result only. There is no
   * existing row to scope with a filter, and — unlike `update`/`delete`,
   * which re-check a returned filter against the target row via
   * `findFirst` — no equivalent re-check exists for a row that doesn't exist
   * in the database yet. A rule that returns a filter (or any other
   * non-boolean) throws `InvalidCreateAccessResultError` rather than being
   * treated as an allow (see #1009, ADR-0022, ADR-0030). To scope create by
   * ownership, evaluate the condition in a `resolveInput`/`validate` hook,
   * where the input data is in scope.
   */
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
 * Hook arguments for the list-level `resolveInput` hook.
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
 * Hook arguments for the list-level `validate` hook (renamed from `validateInput` for Keystone compatibility).
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
 * Hook arguments for the list-level `beforeOperation` hook.
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
 * Hook arguments for the list-level `afterOperation` hook.
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

/**
 * Hook arguments for the list-level beforeTransaction hook (#590 / ADR-0010).
 *
 * Runs BEFORE the write's transaction opens (outside it). Has input data but no
 * persisted `item`. For update/delete the existing `item` is best-effort:
 * present for the top-level target (resolved before the transaction opens) and
 * `undefined` for nested targets. For non-transactional side effects whose
 * compensation pairs with `afterTransaction`.
 */
export type BeforeTransactionHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      inputData: TCreateInput
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      inputData: TUpdateInput
      item: TOutput | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'delete'
      item: TOutput | undefined
      context: import('../access/types.js').AccessContext
    }

/**
 * Hook arguments for the list-level afterTransaction hook (#590 / ADR-0010).
 *
 * Runs AFTER the write's transaction settles and ALWAYS runs when the paired
 * `beforeTransaction` ran (symmetric bracket). The `status` discriminant tells
 * the hook whether the write committed or rolled back:
 *  - `committed`: the persisted `item`/`originalItem` are populated ONLY for the
 *    TOP-LEVEL record of the write. For NESTED lists they are `undefined` — the
 *    per-record persisted row is not reliably recoverable outside the
 *    transaction (recovering it would duplicate #569's in-transaction id-diff
 *    machinery), and these hooks fire at per-(list, operation) granularity, not
 *    per record. For per-record nested compensation use the in-transaction
 *    `afterOperation` (which receives the correct nested `item`);
 *    transaction-boundary hooks are for external-call compensation keyed off
 *    `status`/`inputData`.
 *  - `rolled-back`: NO persisted `item`; the hook gets `inputData` and the
 *    `error` that caused the rollback so it can compensate.
 */
export type AfterTransactionHookArgs<
  TOutput = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> =
  | {
      listKey: string
      operation: 'create'
      status: 'committed'
      inputData: TCreateInput
      /** Persisted row — populated for the top-level list only; `undefined` for nested lists. */
      item: TOutput | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'create'
      status: 'rolled-back'
      inputData: TCreateInput
      error: unknown
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      status: 'committed'
      inputData: TUpdateInput
      /** Pre-write row — populated for the top-level list only; `undefined` for nested lists. */
      originalItem: TOutput | undefined
      /** Persisted row — populated for the top-level list only; `undefined` for nested lists. */
      item: TOutput | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'update'
      status: 'rolled-back'
      inputData: TUpdateInput
      originalItem: TOutput | undefined
      error: unknown
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'delete'
      status: 'committed'
      /** Pre-write row — populated for the top-level list only; `undefined` for nested lists. */
      originalItem: TOutput | undefined
      context: import('../access/types.js').AccessContext
    }
  | {
      listKey: string
      operation: 'delete'
      status: 'rolled-back'
      originalItem: TOutput | undefined
      error: unknown
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
   * Side effect BEFORE the write's transaction opens (#590 / ADR-0010).
   * Runs OUTSIDE the transaction — for non-transactional work (external API
   * calls). Throwing aborts the write; the paired `afterTransaction` then fires
   * with `status: 'rolled-back'`. See {@link BeforeTransactionHookArgs}.
   */
  beforeTransaction?: (
    args: BeforeTransactionHookArgs<TOutput, TCreateInput, TUpdateInput>,
  ) => Promise<void> | void
  /**
   * Side effect AFTER the write's transaction settles (#590 / ADR-0010).
   * ALWAYS runs when `beforeTransaction` ran; receives `committed | rolled-back`
   * + `error`. The persisted `item`/`originalItem` are present only on commit
   * AND only for the top-level record (`undefined` for nested lists). The
   * compensation half of the transaction-boundary bracket. See
   * {@link AfterTransactionHookArgs}.
   */
  afterTransaction?: (
    args: AfterTransactionHookArgs<TOutput, TCreateInput, TUpdateInput>,
  ) => Promise<void> | void
  /**
   * @deprecated Use 'validate' instead. This alias is provided for backwards compatibility.
   */
  validateInput?: (args: ValidateHookArgs<TOutput, TCreateInput, TUpdateInput>) => Promise<void>
}

/**
 * A single field reference within a model-level {@link ListIndex}. Either
 * just the OpenSaaS field name, or an object naming it alongside a sort
 * direction.
 */
export type ListIndexFieldRef =
  | string
  | {
      field: string
      /** Sort direction for this column within the index/constraint. */
      sort?: 'asc' | 'desc'
    }

/**
 * A model-level `@@unique`/`@@index` constraint spanning one or more of a
 * list's own fields. See {@link ListConfig.db}'s `indexes` for the full
 * explanation and examples (#864, #918).
 */
export type ListIndex = {
  /**
   * The fields participating in this index/constraint, in declaration order.
   * OpenSaaS field names, not raw database column names.
   *
   * One or more fields — a named single-column constraint is as legitimate
   * as a composite one, and is the form to reach for when a live table's
   * constraint carries a name Prisma wouldn't derive on its own. Field-level
   * `isIndexed` remains the sugar for the unnamed single-column case; this
   * is the full form when a name or a sort direction is needed.
   */
  fields: ListIndexFieldRef[]
  /**
   * Emit `@@unique([...])` instead of `@@index([...])`.
   * @default false
   */
  unique?: boolean
  /**
   * Constraint/index name, emitted as Prisma's `map:` argument — lets an
   * existing live constraint be adopted under its current name rather than
   * renamed.
   */
  name?: string
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
    /**
     * Model-level `@@unique`/`@@index` constraints spanning one or more of
     * this list's own fields (#864, #918). See the [reference
     * docs](https://stack.opensaas.au/docs/reference/config-api#dbindexes)
     * for the full explanation, arity, and error conditions.
     *
     * Field-level `isIndexed` (on a scalar or relationship field) is the
     * sugar for the unnamed single-column case. `db.indexes` is the full
     * form — reach for it when a constraint needs a `name` (Prisma's `map:`,
     * for adopting an existing live constraint), a `sort` direction, or spans
     * more than one column. Arity is incidental: each entry names one or
     * more of the list's own OpenSaaS field names, not raw database column
     * names. The generator resolves each to its underlying Prisma column — a
     * scalar field's own name (its Prisma field name is unaffected by
     * `db.map`), or a relationship field's foreign key column (`<field>Id`)
     * when this side owns it.
     *
     * A **unique** entry is the load-bearing case: it's the database-level
     * backstop for a business rule concurrent writes could otherwise both
     * slip past (e.g. "one booking per student per production", or a
     * single-column unique a live table already enforces under a name Prisma
     * wouldn't derive) — something a hook's existence check cannot close on
     * its own, and can't be retrofitted once duplicate rows exist. An
     * **index** (non-unique) entry is the equivalent performance-only case
     * (a hot lookup path).
     *
     * Two conditions fail `pnpm generate` with an error naming the list and
     * the entry: an empty `fields` array, and a single-field entry that
     * indexes the exact column a field-level `isIndexed` on the same list
     * already indexes (the error also names that field and its `isIndexed`
     * value — one of the two should be removed). An entry naming a field the
     * list doesn't have, a virtual field, a to-many relationship, or the
     * non-FK side of a one-to-one relationship fails the same way, naming
     * the bad field too — no entry is ever silently dropped or emitted as
     * invalid Prisma.
     *
     * `createdAt`/`updatedAt` are a valid entry even when the list has no
     * matching declared field — an entry may name either as long as the
     * list's auto-timestamps (`db.timestamps`, global or per-list) are
     * enabled for that column, since the auto-injected column has no `@map`
     * of its own and its Prisma field name is exactly `createdAt`/`updatedAt`.
     *
     * @example One audition per student per production (composite unique)
     * ```typescript
     * Audition: list({
     *   fields: {
     *     student: relationship({ ref: 'Student.auditions' }),
     *     production: relationship({ ref: 'Production.auditions' }),
     *   },
     *   db: {
     *     indexes: [{ fields: ['student', 'production'], unique: true }],
     *   },
     * })
     * // Generates: @@unique([studentId, productionId])
     * ```
     *
     * @example Hot lookup path (composite index) with a sort direction and an adopted constraint name
     * ```typescript
     * AuthVerification: list({
     *   fields: {
     *     identifier: text(),
     *     createdAt: timestamp(),
     *   },
     *   db: {
     *     indexes: [
     *       {
     *         fields: ['identifier', { field: 'createdAt', sort: 'desc' }],
     *         name: 'AuthVerification_identifier_createdAt_idx',
     *       },
     *     ],
     *   },
     * })
     * // Generates: @@index([identifier, createdAt(sort: Desc)], map: "AuthVerification_identifier_createdAt_idx")
     * ```
     *
     * @example Naming a single-column unique constraint (adopting a live table's existing name)
     * ```typescript
     * RateLimit: list({
     *   fields: { key: text() }, // no isIndexed here — db.indexes owns this column instead
     *   db: {
     *     indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }],
     *   },
     * })
     * // Generates: @@unique([key], map: "RateLimit_key_key")
     * // Setting key's own isIndexed too would duplicate this constraint and
     * // fail generation — one of the two must own the column.
     * ```
     */
    indexes?: ListIndex[]
  }
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
  /**
   * UI configuration for this list (admin interface).
   *
   * Mirrors Keystone's list-level `ui` block. Currently only `listView`
   * defaults (columns + sort) are supported.
   */
  ui?: ListUIConfig
}

/**
 * List-level UI configuration for the admin interface.
 *
 * Mirrors Keystone's `ui` block on a list. List-view defaults (column
 * selection/order and default sort) and the label field are supported
 * today; other Keystone concerns (`label`, `description`) are intentionally
 * deferred as they cover navigation text rather than list-view or
 * row-labelling defaults.
 */
export type ListUIConfig = {
  /**
   * Default list-view (table) configuration for this list, mirroring
   * Keystone's `ui.listView`.
   */
  listView?: ListViewUIConfig
  /**
   * Item-view (record edit page) configuration for this list — controls the
   * placement/order of the shape-derived Relationship-table sections (issue
   * #734). When omitted, sections appear in field-declaration order and the
   * layout is derived purely from the number of to-many relationships.
   */
  itemView?: ItemViewUIConfig
  /**
   * The field used to represent a row as a single label — in relationship
   * cells, dropdown options, and page headings. Must reference a declared,
   * non-relationship field on this list.
   *
   * When omitted, resolves via `getLabelFieldName`'s fallback order: `name`
   * → `title` → `id` (first field that exists on the list).
   *
   * @example
   * ```typescript
   * ui: { labelField: 'email' }
   * ```
   */
  labelField?: string
  /**
   * Opt this list into an access-scoped record count next to its Admin chrome
   * nav item (issue #735). Default `false` — no count query runs for lists that
   * don't opt in. The count is fetched through the secured context, so it only
   * ever reflects what the current session may see; a list whose query access
   * is statically denied renders no count rather than a misleading zero.
   *
   * @example
   * ```typescript
   * ui: { navCount: true }
   * ```
   */
  navCount?: boolean
  /**
   * Opt this list's label column into an initials-avatar Cell (issue #735) — an
   * initials bubble whose text and colour derive deterministically from the row,
   * rendered ahead of the emphasized {@link getItemLabel Item label}. Default
   * `false` (text-only label). A per-field cell override (`ui.cell`) on the
   * label field still wins.
   *
   * @example
   * ```typescript
   * ui: { avatar: true }
   * ```
   */
  avatar?: boolean
}

/**
 * Item-view (record edit page) configuration, mirroring the `ui.listView`
 * shape but for the shape-derived item layout (issue #734).
 *
 * The layout itself — single card / two-column split / stacked — is derived
 * from the number of to-many relationships rendered as Relationship tables and
 * needs no configuration. This block only reorders those sections; the
 * per-relationship column/sum/picker overrides live on the relationship field
 * (`ui.itemView`, see {@link RelationshipItemViewConfig}).
 */
export type ItemViewUIConfig = {
  /**
   * The order of the Relationship-table sections, by their to-many
   * relationship field name. Listed fields come first in this order; any
   * to-many relationship not listed keeps its declaration order after them.
   *
   * @example
   * ```typescript
   * ui: { itemView: { order: ['orders', 'reviews'] } }
   * ```
   */
  order?: string[]
}

/**
 * A button variant for a custom Bulk action, matching the admin UI's Button
 * variants. Serializable — it crosses to the client selection bar as a plain
 * string.
 */
export type BulkActionVariant =
  'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'

/**
 * Arguments passed to a custom Bulk action's server-side `handler` (issue #736).
 *
 * The handler runs entirely server-side — it is NEVER serialized to the client —
 * and must do all of its work through the SECURED `context` (never raw Prisma),
 * so per-row access control still applies and a denied row is a Silent failure.
 */
export interface BulkActionContext {
  /** The list the action was invoked on (PascalCase list key). */
  listKey: string
  /** The explicit set of selected row ids the admin chose. */
  ids: string[]
  /**
   * The access-scoped context. All database work MUST go through `context.db`
   * so the list's access control and hooks are enforced for every id.
   */
  context: import('../access/types.js').AccessContext
}

/**
 * The outcome a Bulk action `handler` returns. The optional `message` is shown
 * in the selection bar's status line once the action completes; returning
 * nothing yields a generic completion message.
 */
export interface BulkActionResult {
  /** Human-readable outcome shown to the admin (e.g. "Published 3 of 5"). */
  message?: string
}

/**
 * A list-specific custom Bulk action declared in `ui.listView.bulkActions`
 * (issue #736). Rendered as a button in the list view's selection bar, in
 * declaration order, alongside the built-in Delete.
 *
 * SERIALISATION BOUNDARY: only `key`, `label`, `variant` and `destructive`
 * cross to the client (as plain data). `handler` and `hasAccess` are
 * server-side functions and never leave the server — the client sends `key`
 * back through the generic server action, which looks the handler up and runs
 * it with the freshly-rebuilt secured context.
 */
export interface BulkAction {
  /**
   * Stable identifier the client echoes back to dispatch this action
   * server-side. Must be unique within the list.
   */
  key: string
  /** Button label shown in the selection bar. */
  label: string
  /** Button variant (defaults to `'outline'`). */
  variant?: BulkActionVariant
  /**
   * When true, the admin is asked to confirm before the action runs, reusing
   * the same confirmation affordance as the built-in Delete.
   */
  destructive?: boolean
  /**
   * Optional visibility gate, evaluated server-side against the session before
   * the button is offered (user story 14 — "only see actions I may perform").
   * Returning `false` hides the button.
   *
   * This ONLY controls visibility; the `handler` always runs through the
   * secured context, so per-row access is enforced regardless. It is also
   * re-checked server-side on dispatch, so a hidden action cannot be invoked.
   */
  hasAccess?: (args: {
    session: import('../access/types.js').Session | null
    context: import('../access/types.js').AccessContext
    listKey: string
  }) => boolean | Promise<boolean>
  /**
   * The server-side handler. Receives the selected ids and the secured
   * `context`; do all work through `context.db`. Returns an optional
   * `{ message }` shown in the selection bar when the action completes.
   */
  handler: (args: BulkActionContext) => BulkActionResult | void | Promise<BulkActionResult | void>
}

/**
 * Default list-view (table) configuration for a list, mirroring Keystone's
 * `ui.listView`.
 *
 * When omitted, the admin UI falls back to its existing defaults: every
 * field whose own `ui.listView.defaultColumn` declaration holds is shown as
 * a column (see {@link BaseFieldConfig.ui}) and no default sort is applied.
 */
export type ListViewUIConfig = {
  /**
   * The fields to show as columns in the list table, in order.
   *
   * Drives both the column **selection** and their **order**. When omitted,
   * every field whose own `ui.listView.defaultColumn` declaration holds is
   * shown (current default behaviour).
   *
   * @example
   * ```typescript
   * ui: { listView: { initialColumns: ['title', 'status', 'author'] } }
   * ```
   */
  initialColumns?: string[]
  /**
   * The default sort applied to the list table.
   *
   * When omitted, no default sort is applied (current default behaviour).
   *
   * @example
   * ```typescript
   * ui: { listView: { initialSort: { field: 'createdAt', direction: 'desc' } } }
   * ```
   */
  initialSort?: {
    /** The field to sort by. Must be a field defined on the list. */
    field: string
    /** The sort direction. */
    direction: 'asc' | 'desc'
  }
  /**
   * Custom list-specific Bulk actions shown in the list view's selection bar,
   * in declaration order, alongside the built-in Delete (issue #736). Each
   * action's `handler` runs server-side over the selected ids through the
   * secured context; only serializable metadata (`key`/`label`/`variant`/
   * `destructive`) crosses to the client.
   *
   * @example
   * ```typescript
   * ui: {
   *   listView: {
   *     bulkActions: [
   *       {
   *         key: 'publish',
   *         label: 'Publish',
   *         handler: async ({ ids, context }) => {
   *           let n = 0
   *           for (const id of ids) {
   *             const r = await context.db.post.update({
   *               where: { id },
   *               data: { status: 'published' },
   *             })
   *             if (r) n++
   *           }
   *           return { message: `Published ${n} of ${ids.length}` }
   *         },
   *       },
   *     ],
   *   },
   * }
   * ```
   */
  bulkActions?: BulkAction[]
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
  /**
   * Override the Prisma `generator client { ... }` options the CLI emits for the
   * `.opensaas` prisma-client subtree.
   *
   * By default the generator emits `importFileExtension = "ts"` and
   * `moduleFormat = "esm"` so the whole generated bundle is statically
   * resolvable and matches the explicit `.ts` import-extension style the rest of
   * the `.opensaas` bundle uses (see ADR-0008). Supply this option only when you
   * need a different module/extension story (e.g. emitting `.js` extensions for a
   * Node-only consumer). Any value you provide wins; omitted keys fall back to
   * the `ts`/`esm` defaults.
   *
   * @example Emit `.js` extensions and CommonJS for a plain-Node consumer
   * ```typescript
   * db: {
   *   provider: 'postgresql',
   *   prismaGeneratorOptions: {
   *     importFileExtension: 'js',
   *     moduleFormat: 'commonjs',
   *   },
   *   // ... rest of config
   * }
   * ```
   */
  prismaGeneratorOptions?: {
    /**
     * Value for the generator's `importFileExtension` option. Defaults to `'ts'`.
     */
    importFileExtension?: 'ts' | 'js'
    /**
     * Value for the generator's `moduleFormat` option. Defaults to `'esm'`.
     */
    moduleFormat?: 'esm' | 'commonjs'
  }
}

export type SessionConfig = {
  // Uses `any` return type because session structure is user-defined and varies per application
  // The stack doesn't enforce a specific session shape - users can use NextAuth, Clerk, etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSession: () => Promise<any>
}

export type ThemePreset = 'modern' | 'classic' | 'neon'

/**
 * Custom theme colors.
 *
 * Each value is passed through verbatim to the corresponding CSS custom
 * property, so any valid CSS color string works: `oklch(…)`, `#hex`, `rgb(…)`,
 * or a wrapped `hsl(…)`. Bare HSL triplets (`"220 20% 97%"`) are a clean break —
 * they are no longer accepted and trigger a dev-mode warning. See
 * `specs/THEMING.md` and ADR-0015.
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
  success?: string
  successForeground?: string
  warning?: string
  warningForeground?: string
  border?: string
  input?: string
  ring?: string
  gradientFrom?: string
  gradientTo?: string
}

/**
 * Font family tokens. Each value is a CSS `font-family` string, designed to
 * compose with `next/font`: set the value to the font's CSS variable, e.g.
 * `sans: 'var(--font-inter), system-ui, sans-serif'`. `heading` defaults to the
 * `sans` value when omitted.
 */
export type ThemeFonts = {
  sans?: string
  mono?: string
  heading?: string
}

/**
 * Elevation shadow tokens. Each value is a CSS `box-shadow` string. Set them to
 * `'none'` for a fully flat theme without forking components.
 */
export type ThemeShadows = {
  sm?: string
  md?: string
  lg?: string
}

/**
 * Theme configuration. Compiles to token overrides written onto the same CSS
 * custom properties the UI package stylesheet declares — the config layer and
 * the stylesheet write to one token set so they can never drift (ADR-0015).
 */
export type ThemeConfig = {
  /**
   * Preset theme to start from. Individual tokens can be overridden on top.
   * @default "modern"
   */
  preset?: ThemePreset
  /**
   * Custom color overrides for light mode.
   */
  colors?: ThemeColors
  /**
   * Custom color overrides for dark mode.
   */
  darkColors?: ThemeColors
  /**
   * Font family overrides (`--font-sans`, `--font-mono`, `--font-heading`).
   */
  fonts?: ThemeFonts
  /**
   * Base border radius in rem. Derived sm/md/lg radii are computed from it.
   * @default 0.625
   */
  radius?: number
  /**
   * Elevation shadow overrides (`--shadow-sm`, `--shadow-md`, `--shadow-lg`).
   */
  shadows?: ThemeShadows
}

export type UIConfig = {
  basePath?: string
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
  description: string
  /**
   * Input schema (Zod schema)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any
  handler: (args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    context: import('../access/types.js').AccessContext
  }) => Promise<unknown>
}

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
   * Throws error if list already exists
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plugin API must accept any list config
  addList: (name: string, listConfig: ListConfig<any>) => void

  /**
   * Extend an existing list with additional fields, hooks, or MCP config.
   * Merges fields, hooks, and MCP config. Throws if the list doesn't exist,
   * or if the extension sets operation-level `access` — access control
   * belongs to whoever created the list, never a plugin extending it
   * (ADR-0013).
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
   *
   * `sudo` returns an access-bypassing (but still hook-firing) `AccessContext`
   * for the same request — use `sudo().db` for reads/writes that must not
   * depend on the caller's own list access policy (e.g. an identity lookup
   * like "who is this session"). Deliberately NOT a method on `AccessContext`
   * itself — a self-referential `sudo(): AccessContext` field on that shared,
   * widely-instantiated interface tripped up TypeScript's structural checking
   * of unrelated generated Prisma types elsewhere (nullable JSON `CreateInput`
   * fields) in a downstream app; passing it as a plain second argument avoids
   * that recursion entirely.
   */
  runtime?: (
    context: import('../access/types.js').AccessContext,
    sudo: () => import('../access/types.js').AccessContext,
  ) => unknown

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
   * plugin-types, and the patched Prisma client).
   * @default ".opensaas"
   */
  opensaasDir?: string
  /**
   * Opt in to an additional **Node build** of the Generated bundle.
   *
   * By default (omitted) the generator emits only the bundler-loadable `.ts`
   * form (ADR-0008): TypeScript with explicit `.ts` import extensions, traced
   * and transpiled by the host's bundler. That form cannot execute under plain
   * Node, so a live module that must run in BOTH a bundled and a bundler-less
   * runtime (e.g. better-auth's Prisma adapter, imported by the Next server AND
   * by a Playwright e2e helper or a build-time script) has no Node-loadable
   * entry to point at.
   *
   * Setting `buildTarget: 'node'` additionally compiles the bundle to a
   * plain-Node-loadable ESM form under `<opensaasDir>/dist/` (`.js` + `.d.ts`,
   * with a `{"type":"module"}` marker). The compiled entry is
   * `<opensaasDir>/dist/context.js`; a portable module imports it directly so
   * the bundler traces it AND plain Node executes it (one specifier, both
   * runtimes — see ADR-0011). The default `.ts` form is unchanged and still
   * emitted; the Node build is purely additive.
   *
   * `'node'` is the only target today. The field is a string-literal union so
   * future compiled targets can be added without a breaking change.
   *
   * @example
   * ```typescript
   * export default config({
   *   output: { buildTarget: 'node' },
   *   // ...
   * })
   * // Then import the compiled entry from a plain-Node consumer:
   * //   const { rawOpensaasContext } = await import('./.opensaas/dist/context.js')
   * ```
   */
  buildTarget?: 'node'
}

/**
 * Main configuration type.
 * Uses an interface, not a type alias, so it can be extended via module augmentation.
 */
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
