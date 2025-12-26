import type {
  OpenSaasConfig,
  ListConfig,
  ListConfigInput,
  OperationAccess,
  ListAccessControl,
} from './types.js'
import { executePlugins } from './plugin-engine.js'
import type { AccessControl } from '../access/types.js'

/**
 * Normalize access control shorthand to object form
 * Converts function shorthand to { operation: { query, create, update, delete } } form
 */
function normalizeListAccess<T>(
  access: ListAccessControl<T> | undefined,
): { operation?: OperationAccess<T> } | undefined {
  if (!access) return undefined

  // If it's a function, convert to object form applying to all operations
  if (typeof access === 'function') {
    const fn = access as AccessControl<T>
    return {
      operation: {
        query: fn,
        create: fn,
        update: fn,
        delete: fn,
      },
    }
  }

  // Already in object form
  return access
}

/**
 * Helper function to define configuration with type safety
 * Executes plugins if present in config.plugins array
 *
 * Note: This function is now async when plugins are present
 * For synchronous config definition without plugins, config can still be returned directly
 */
export function config(userConfig: OpenSaasConfig): OpenSaasConfig | Promise<OpenSaasConfig> {
  // If no plugins, return config as-is (synchronous, backward compatible)
  if (!userConfig.plugins || userConfig.plugins.length === 0) {
    return userConfig
  }

  // Execute plugins and return promise
  return executePlugins(userConfig)
}

/**
 * Helper function to define a list with type safety
 *
 * Accepts raw field configs and transforms them to inject the item type
 * This enables proper typing in field hooks where item is typed correctly
 *
 * @example
 * ```typescript
 * // Basic usage (before generation)
 * Post: list({
 *   fields: { title: text() },
 *   hooks: {
 *     resolveInput: async ({ resolvedData }) => {
 *       // resolvedData: Record<string, unknown>
 *       return resolvedData
 *     }
 *   }
 * })
 *
 * // With TypeInfo (after generation)
 * import type { Lists } from './.opensaas/lists'
 *
 * Post: list<Lists.Post.TypeInfo>({
 *   fields: { title: text() },
 *   hooks: {
 *     resolveInput: async ({ operation, resolvedData, item }) => {
 *       if (operation === 'create') {
 *         // resolvedData: Prisma.PostCreateInput
 *         // item: undefined
 *       } else {
 *         // resolvedData: Prisma.PostUpdateInput
 *         // item: Post
 *       }
 *       return resolvedData
 *     }
 *   }
 * })
 *
 * // Or as a typed constant
 * const Post: Lists.Post = list({
 *   fields: { title: text() },
 *   hooks: { ... }
 * })
 *
 * // Access control shorthand
 * const isAdmin = ({ session }) => session?.role === 'admin'
 *
 * Settings: list({
 *   access: isAdmin,  // Applies to all operations
 *   isSingleton: true,
 *   fields: { ... }
 * })
 * ```
 */
export function list<TTypeInfo extends import('./types.js').TypeInfo>(
  config: ListConfigInput<TTypeInfo>,
): ListConfig<TTypeInfo> {
  // Normalize access control shorthand to object form
  const normalizedConfig = {
    ...config,
    access: normalizeListAccess(config.access),
  }

  // At runtime, field configs are unchanged
  // At type level, they're transformed to inject TypeInfo types
  return normalizedConfig as ListConfig<TTypeInfo>
}

// Re-export all types
export type {
  OpenSaasConfig,
  ListConfig,
  ListConfigInput,
  ListAccessControl,
  FieldConfig,
  BaseFieldConfig,
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
  JsonField,
  VirtualField,
  TypeDescriptor,
  TypeInfo,
  OperationAccess,
  Hooks,
  FieldHooks,
  FieldsWithTypeInfo,
  DatabaseConfig,
  SessionConfig,
  UIConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
  McpConfig,
  McpToolsConfig,
  McpAuthConfig,
  ListMcpConfig,
  McpCustomTool,
  FileMetadata,
  ImageMetadata,
  ImageTransformationResult,
  // Plugin system types
  Plugin,
  PluginContext,
  GeneratedFiles,
} from './types.js'
