import type { OpenSaasConfig, ListConfig, FieldConfig, OperationAccess, Hooks } from './types.js'
import { executePlugins } from './plugin-engine.js'

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
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function list<
  TTypeInfo extends import('./types.js').TypeInfo = import('./types.js').TypeInfo,
>(config: {
  fields: Record<string, FieldConfig>
  access?: {
    operation?: OperationAccess<TTypeInfo['item']>
  }
  hooks?: Hooks<TTypeInfo['item'], TTypeInfo['inputs']['create'], TTypeInfo['inputs']['update']>
  mcp?: import('./types.js').ListMcpConfig
}): ListConfig<TTypeInfo['item'], TTypeInfo['inputs']['create'], TTypeInfo['inputs']['update']> {
  // At runtime, field configs are unchanged
  // At type level, they're transformed to inject TypeInfo types
  return config as ListConfig<
    TTypeInfo['item'],
    TTypeInfo['inputs']['create'],
    TTypeInfo['inputs']['update']
  >
}

// Re-export all types
export type {
  OpenSaasConfig,
  ListConfig,
  FieldConfig,
  BaseFieldConfig,
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
  TypeInfo,
  OperationAccess,
  Hooks,
  FieldHooks,
  FieldsWithItemType,
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
