import type { OpenSaasConfig, ListConfig } from './types.js'

/**
 * Helper function to define configuration with type safety
 */
export function config(config: OpenSaasConfig): OpenSaasConfig {
  return config
}

/**
 * Helper function to define a list with type safety
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function list<T = any>(config: ListConfig<T>): ListConfig<T> {
  return config
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
  FieldHookArgs,
  DatabaseConfig,
  SessionConfig,
  UIConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
} from './types.js'
