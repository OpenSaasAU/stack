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
 * Field hook arguments
 * Similar to list hooks but scoped to a single field value
 */
export type FieldHookArgs = {
  operation: 'create' | 'update' | 'delete' | 'read'
  value: unknown
  fieldName: string
  listName: string
  item?: Record<string, unknown>
  context: import('../access/types.js').AccessContext
}

/**
 * Field-level hooks for data transformation
 * Allows field types to define custom behavior during operations
 */
export type FieldHooks = {
  /**
   * Transform field value before database write
   * Called during create/update operations after resolveInput and validation
   *
   * @example
   * ```typescript
   * beforeOperation: async ({ value, operation }) => {
   *   if (operation === 'create' || operation === 'update') {
   *     return await hashPassword(value)
   *   }
   *   return value
   * }
   * ```
   */
  beforeOperation?: (args: FieldHookArgs & { operation: 'create' | 'update' }) => Promise<unknown>

  /**
   * Transform field value after database read
   * Called when returning results from query operations
   *
   * @example
   * ```typescript
   * afterOperation: ({ value }) => {
   *   return new HashedPassword(value)
   * }
   * ```
   */
  afterOperation?: (args: FieldHookArgs & { operation: 'read' }) => unknown
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

export type BaseFieldConfig = {
  type: string
  access?: FieldAccess
  defaultValue?: unknown
  hooks?: FieldHooks
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
}

export type TextField = BaseFieldConfig & {
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

export type IntegerField = BaseFieldConfig & {
  type: 'integer'
  validation?: {
    isRequired?: boolean
    min?: number
    max?: number
  }
}

export type CheckboxField = BaseFieldConfig & {
  type: 'checkbox'
}

export type TimestampField = BaseFieldConfig & {
  type: 'timestamp'
  defaultValue?: { kind: 'now' } | Date
}

export type PasswordField = BaseFieldConfig & {
  type: 'password'
  validation?: {
    isRequired?: boolean
  }
}

export type SelectField = BaseFieldConfig & {
  type: 'select'
  options: Array<{ label: string; value: string }>
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
  }
}

export type RelationshipField = BaseFieldConfig & {
  type: 'relationship'
  ref: string // Format: 'ListName.fieldName'
  many?: boolean
  ui?: {
    displayMode?: 'select' | 'cards'
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
  | BaseFieldConfig // Allow any field extending BaseFieldConfig (for third-party fields)

/**
 * List configuration types
 */
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
  fields: Record<string, FieldConfig>
  access?: {
    operation?: OperationAccess<T>
  }
  hooks?: Hooks<T>
}

/**
 * Database configuration
 */
export type DatabaseConfig = {
  provider: 'postgresql' | 'mysql' | 'sqlite'
  url: string
  /**
   * Optional factory function to create a custom Prisma client instance
   * Receives the PrismaClient class and returns a configured instance
   *
   * @example
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
  prismaClientConstructor?: (PrismaClientClass: any) => any
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
 * Main configuration type
 */
export type OpenSaasConfig = {
  db: DatabaseConfig
  lists: Record<string, ListConfig>
  session?: SessionConfig
  ui?: UIConfig
  /**
   * Path where OpenSaas generates files (context, types, patched Prisma client)
   * @default ".opensaas"
   */
  opensaasPath?: string
}
