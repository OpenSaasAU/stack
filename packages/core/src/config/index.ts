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
 * Accepts raw field configs and transforms them to inject the item type T
 * This enables proper typing in field hooks where item: T
 *
 * @example
 * ```typescript
 * import type { User } from './.opensaas/types'
 *
 * User: list<User>({
 *   fields: {
 *     password: password({
 *       hooks: {
 *         resolveInput: async ({ inputValue, item }) => {
 *           // item is typed as User | undefined
 *           // inputValue is typed as string | undefined
 *           return hashPassword(inputValue)
 *         }
 *       }
 *     })
 *   }
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function list<T = any>(config: {
  fields: Record<string, FieldConfig>
  access?: {
    operation?: OperationAccess<T>
  }
  hooks?: Hooks<T>
  mcp?: import('./types.js').ListMcpConfig
}): ListConfig<T> {
  // At runtime, field configs are unchanged
  // At type level, they're transformed to inject T as the item type
  return config as ListConfig<T>
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
