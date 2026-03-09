// Config system
export { config, list } from './config/index.js'
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
  // List-level hook argument types
  ResolveInputHookArgs,
  ValidateHookArgs,
  BeforeOperationHookArgs,
  AfterOperationHookArgs,
  // Field-level hook argument types
  FieldResolveInputHookArgs,
  FieldValidateHookArgs,
  FieldBeforeOperationHookArgs,
  FieldAfterOperationHookArgs,
  FieldResolveOutputHookArgs,
} from './config/index.js'

// Access control
export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
  AccessControlledDB,
  StorageUtils,
  AugmentedFindMany,
  AugmentedFindUnique,
  FindManyQueryArgs,
} from './access/index.js'

// Context
export { getContext } from './context/index.js'
export type { PrismaClientLike } from './access/types.js'
export type { ServerActionProps } from './context/index.js'

// Utilities
export {
  getDbKey,
  getUrlKey,
  getListKeyFromUrl,
  pascalToCamel,
  pascalToKebab,
  kebabToPascal,
  kebabToCamel,
} from './lib/case-utils.js'

// Hooks and validation
export { ValidationError } from './hooks/index.js'
export { validateWithZod, generateZodSchema } from './validation/schema.js'

// Password utilities
export {
  hashPassword,
  comparePassword,
  isHashedPassword,
  HashedPassword,
} from './utils/password.js'

// Query utilities — fragment-based, type-safe query helpers
export { defineFragment, runQuery, runQueryOne } from './query/index.js'
export type {
  Fragment,
  FieldSelection,
  ResultOf,
  RelationSelector,
  QueryArgs,
  QueryRunnerContext,
} from './query/index.js'
