// Config system
export { config, list } from "./config/index.js";
export type {
  OpenSaaSConfig,
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
  DatabaseConfig,
  SessionConfig,
  UIConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
} from "./config/index.js";

// Access control
export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
  AccessControlledDB,
} from "./access/index.js";

// Context
export { getContext } from "./context/index.js";
export type { PrismaClientLike } from "./access/types.js";

// Utilities
export { getDbKey, getUrlKey, getListKeyFromUrl, pascalToCamel, pascalToKebab, kebabToPascal, kebabToCamel } from "./lib/case-utils.js";

// Hooks and validation
export { ValidationError } from "./hooks/index.js";
export { validateWithZod, generateZodSchema } from "./validation/schema.js";
