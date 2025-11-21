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
 * Field-level hooks for data transformation and side effects
 * Allows field types to define custom behavior during operations
 *
 * @template TInput - Type of the input value (what goes into the database)
 * @template TOutput - Type of the output value (what comes out of the database)
 * @template TItem - Type of the parent item/record
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FieldHooks<TInput = any, TOutput = TInput, TItem = any> = {
  /**
   * Transform field value before database write
   * Called during create/update operations after list-level resolveInput but before validation
   * This is where you should transform input data (e.g., hash passwords, normalize values)
   *
   * @example
   * ```typescript
   * resolveInput: async ({ inputValue, operation }) => {
   *   if (typeof inputValue === 'string' && !isHashedPassword(inputValue)) {
   *     return await hashPassword(inputValue)
   *   }
   *   return inputValue
   * }
   * ```
   */
  resolveInput?: (args: {
    operation: 'create' | 'update'
    inputValue: TInput | undefined
    item?: TItem
    listKey: string
    fieldName: string
    context: import('../access/types.js').AccessContext
  }) => Promise<TInput | undefined> | TInput | undefined

  /**
   * Perform side effects before database write
   * Called during create/update/delete operations after validation and access control
   * This should ONLY contain side effects (logging, notifications, etc.), not data transformation
   *
   * @example
   * ```typescript
   * beforeOperation: async ({ resolvedValue, operation, item }) => {
   *   console.log(`About to ${operation} field with value:`, resolvedValue)
   *   await sendAuditLog({ operation, item })
   * }
   * ```
   */
  beforeOperation?: (args: {
    operation: 'create' | 'update' | 'delete'
    resolvedValue: TInput | undefined
    item?: TItem
    listKey: string
    fieldName: string
    context: import('../access/types.js').AccessContext
  }) => Promise<void> | void

  /**
   * Perform side effects after database operation
   * Called after any database operation (create/update/delete/query)
   * This should ONLY contain side effects (logging, cache invalidation, etc.), not data transformation
   *
   * @example
   * ```typescript
   * afterOperation: async ({ operation, value, item }) => {
   *   await invalidateCache({ listKey, itemId: item.id })
   *   await sendWebhook({ operation, item })
   * }
   * ```
   */
  afterOperation?: (
    args:
      | {
          operation: 'create' | 'update' | 'delete'
          value: TInput | undefined
          item: TItem
          listKey: string
          fieldName: string
          context: import('../access/types.js').AccessContext
        }
      | {
          operation: 'query'
          value: TOutput | undefined
          item: TItem
          listKey: string
          fieldName: string
          context: import('../access/types.js').AccessContext
        },
  ) => Promise<void> | void

  /**
   * Transform field value after database read
   * Called when returning results from query operations
   * This is where you should transform output data (e.g., wrap passwords, format values)
   *
   * @example
   * ```typescript
   * resolveOutput: ({ value }) => {
   *   if (typeof value === 'string' && value.length > 0) {
   *     return new HashedPassword(value)
   *   }
   *   return value
   * }
   * ```
   */
  resolveOutput?: (args: {
    operation: 'query'
    value: TInput | undefined
    item: TItem
    listKey: string
    fieldName: string
    context: import('../access/types.js').AccessContext
  }) => TOutput | undefined
}

/**
 * Configuration for patching Prisma-generated types
 * Allows fields to transform their types in query results
 */
export type TypePatchConfig = {
  /**
   * The TypeScript type to use in Prisma result types (e.g., Payload scalars)
   * This is an import statement like: "import('@opensaas/stack-core').HashedPassword"
   */
  resultType: string
  /**
   * Optional: Where to apply the patch
   * - 'scalars-only': Only patch in Payload scalars (default, safest)
   * - 'all': Patch everywhere the field appears (including inputs)
   */
  patchScope?: 'scalars-only' | 'all'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BaseFieldConfig<TInput = any, TOutput = TInput> = {
  type: string
  access?: FieldAccess
  defaultValue?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks?: FieldHooks<TInput, TOutput, any>
  /**
   * Type patching configuration for Prisma-generated types
   * When specified, the generator will patch Prisma's types to use
   * the specified type in query results instead of the original type
   */
  typePatch?: TypePatchConfig
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
   * @returns Prisma type string and optional modifiers
   */
  getPrismaType?: (fieldName: string) => {
    type: string
    modifiers?: string
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

export type TextField = BaseFieldConfig<string, string> & {
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

export type IntegerField = BaseFieldConfig<number, number> & {
  type: 'integer'
  validation?: {
    isRequired?: boolean
    min?: number
    max?: number
  }
}

export type CheckboxField = BaseFieldConfig<boolean, boolean> & {
  type: 'checkbox'
}

export type TimestampField = BaseFieldConfig<Date, Date> & {
  type: 'timestamp'
  defaultValue?: { kind: 'now' } | Date
}

export type PasswordField = BaseFieldConfig<
  string,
  import('../utils/password.js').HashedPassword
> & {
  type: 'password'
  validation?: {
    isRequired?: boolean
  }
}

export type SelectField = BaseFieldConfig<string, string> & {
  type: 'select'
  options: Array<{ label: string; value: string }>
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
  }
}

export type RelationshipField = BaseFieldConfig<string | string[], string | string[]> & {
  type: 'relationship'
  ref: string // Format: 'ListName.fieldName'
  many?: boolean
  ui?: {
    displayMode?: 'select' | 'cards'
  }
}

export type JsonField = BaseFieldConfig<unknown, unknown> & {
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

export type FieldConfig =
  | TextField
  | IntegerField
  | CheckboxField
  | TimestampField
  | PasswordField
  | SelectField
  | RelationshipField
  | JsonField
  | BaseFieldConfig // Allow any field extending BaseFieldConfig (for third-party fields)

/**
 * List configuration types
 */

/**
 * Utility type to inject item type into a single field config
 * Extracts TInput and TOutput from BaseFieldConfig<TInput, TOutput> and reconstructs with new hooks type
 */
type WithItemType<TField extends FieldConfig, TItem> =
  TField extends BaseFieldConfig<infer TInput, infer TOutput>
    ? Omit<TField, 'hooks'> & {
        hooks?: FieldHooks<TInput, TOutput, TItem>
      }
    : TField

/**
 * Utility type to transform all fields in a record to inject item type
 * Maps over each field and applies WithItemType transformation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FieldsWithItemType<TFields extends Record<string, FieldConfig>, TItem = any> = {
  [K in keyof TFields]: WithItemType<TFields[K], TItem>
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

export type HookArgs<T = Record<string, unknown>> = {
  operation: 'create' | 'update' | 'delete'
  resolvedData?: Partial<T>
  item?: T
  context: import('../access/types.js').AccessContext
}

export type Hooks<T = Record<string, unknown>> = {
  resolveInput?: (args: HookArgs<T> & { operation: 'create' | 'update' }) => Promise<Partial<T>>
  validateInput?: (
    args: HookArgs<T> & {
      operation: 'create' | 'update'
      addValidationError: (msg: string) => void
    },
  ) => Promise<void>
  beforeOperation?: (args: HookArgs<T>) => Promise<void>
  afterOperation?: (args: HookArgs<T>) => Promise<void>
}

// Generic `any` default allows ListConfig to work with any list item type
// This is needed because the item type varies per list and is inferred from Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ListConfig<T = any> = {
  // Field configs are automatically transformed to inject the item type T
  // This enables proper typing in field hooks where item: TItem
  fields: FieldsWithItemType<Record<string, FieldConfig>, T>
  access?: {
    operation?: OperationAccess<T>
  }
  hooks?: Hooks<T>
  /**
   * MCP server configuration for this list
   */
  mcp?: ListMcpConfig
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
   * import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
   * import Database from 'better-sqlite3'
   *
   * prismaClientConstructor: (PrismaClient) => {
   *   const db = new Database(process.env.DATABASE_URL || './dev.db')
   *   const adapter = new PrismaBetterSQLite3(db)
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
  addList: (name: string, listConfig: ListConfig) => void

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
  registerFieldType?: (type: string, builder: (options?: unknown) => BaseFieldConfig) => void

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
export interface OpenSaasConfig {
  db: DatabaseConfig
  lists: Record<string, ListConfig>
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
