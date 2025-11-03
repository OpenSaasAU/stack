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
  OperationAccess,
  Hooks,
  FieldHooks,
  DatabaseConfig,
  SessionConfig,
  UIConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
  FileMetadata,
  ImageMetadata,
  ImageTransformationResult,
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
