// Config system
export { config, list } from "./config/index.js";
export type {
  OpenSaaSConfig,
  ListConfig,
  FieldConfig,
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
} from "./config/index.js";

// Access control
export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
} from "./access/index.js";

// Context
export { getContext } from "./context/index.js";
export type { PrismaClientLike } from "./context/index.js";

// Utilities
export { getDbKey, getUrlKey, getListKeyFromUrl, pascalToCamel, pascalToKebab, kebabToPascal, kebabToCamel } from "./lib/case-utils.js";

// Hooks
export { ValidationError } from "./hooks/index.js";

// Generators (for CLI use)
export {
  generatePrismaSchema,
  writePrismaSchema,
  generateTypes,
  writeTypes,
} from "./generator/index.js";
