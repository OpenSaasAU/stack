import type { OpenSaasConfig, ListConfig, FieldConfig, OperationAccess, Hooks } from './types.js'

/**
 * Helper function to define configuration with type safety
 */
export function config(config: OpenSaasConfig): OpenSaasConfig {
  return config
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
export function list<T = any>(
  config: {
    fields: Record<string, FieldConfig>
    access?: {
      operation?: OperationAccess<T>
    }
    hooks?: Hooks<T>
  },
): ListConfig<T> {
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
} from './types.js'
