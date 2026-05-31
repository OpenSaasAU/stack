// ───────────────────────────────────────────────────────────────
// @opensaas/stack-core — consumer entry point
//
// The everyday surface for defining a config and using a context.
//   • Field builders            → '@opensaas/stack-core/fields'
//   • Plugin / field authoring  → '@opensaas/stack-core/extend'
//   • MCP runtime               → '@opensaas/stack-core/mcp'
// Internal plumbing lives on '@opensaas/stack-core/internal' (unstable).
// ───────────────────────────────────────────────────────────────

// Config builders
export { config, list } from './config/index.js'

// Config + field types a consumer annotates with
export type {
  OpenSaasConfig,
  ListConfig,
  FieldConfig,
  // Field config types (relocating to /fields in a later change)
  TextField,
  IntegerField,
  CheckboxField,
  TimestampField,
  PasswordField,
  SelectField,
  RelationshipField,
  JsonField,
  VirtualField,
  PrismaRelationResult,
  OperationAccess,
} from './config/index.js'

// Access control — the types a consumer writes against
export type {
  AccessControl,
  FieldAccess,
  Session,
  AccessContext,
  PrismaFilter,
} from './access/index.js'

// Context factory
export { getContext } from './context/index.js'

// Naming utilities (documented public helpers; used for URLs and db keys)
export { getDbKey, getUrlKey, getListKeyFromUrl } from './lib/case-utils.js'

// Validation error surfaced by write operations
export { ValidationError } from './hooks/index.js'
