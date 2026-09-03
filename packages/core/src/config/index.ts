import type {
  OpenSaasConfig,
  ListConfig,
  ListConfigInput,
  OperationAccess,
  ListAccessControl,
} from './types.js'
import { executePlugins } from './plugin-engine.js'
import type { AccessControl } from '../access/types.js'

function normalizeListAccess<T>(
  access: ListAccessControl<T> | undefined,
): { operation?: OperationAccess<T> } | undefined {
  if (!access) return undefined

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

  return access
}

/**
 * Define an OpenSaas config, executing `plugins` if present.
 *
 * Returns synchronously when there are no plugins (backward compatible);
 * returns a `Promise` when plugins are present, since plugin execution is
 * async.
 */
export function config(userConfig: OpenSaasConfig): OpenSaasConfig | Promise<OpenSaasConfig> {
  if (!userConfig.plugins || userConfig.plugins.length === 0) {
    return userConfig
  }

  return executePlugins(userConfig)
}

/**
 * Define a list with type safety.
 *
 * `ListConfigInput<TTypeInfo>` accepts raw field configs; the return type
 * `ListConfig<TTypeInfo>` injects `TTypeInfo` so hook/field callbacks (e.g.
 * `resolveInput`'s `item`) are properly typed once `TTypeInfo` is supplied
 * from generated types.
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
  const normalizedConfig = {
    ...config,
    access: normalizeListAccess(config.access),
  }

  // Runtime shape is unchanged; the cast only narrows the TS type to inject TTypeInfo.
  return normalizedConfig as ListConfig<TTypeInfo>
}

export type {
  OpenSaasConfig,
  OutputConfig,
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
  PrismaRelationResult,
  MultiColumnPrismaResult,
  ContractLiteral,
  ColumnTypeDescriptor,
  ColumnDefaultDescriptor,
  ContractColumnDescriptor,
  ContractForeignKeyDescriptor,
  ContractRelationDescriptor,
  ContractFieldDescriptor,
  JsonField,
  VirtualField,
  TypeDescriptor,
  TypeInfo,
  OperationAccess,
  Hooks,
  FieldHooks,
  FieldsWithTypeInfo,
  DatabaseConfig,
  DatabaseClientConfig,
  ExtensionDescriptor,
  IdFieldStrategy,
  ReferentialAction,
  ListIndex,
  ListIndexFieldRef,
  SessionConfig,
  UIConfig,
  ListUIConfig,
  ListViewUIConfig,
  BulkAction,
  BulkActionContext,
  BulkActionResult,
  BulkActionVariant,
  ItemViewUIConfig,
  RelationshipItemViewConfig,
  ThemeConfig,
  ThemePreset,
  ThemeColors,
  ThemeFonts,
  ThemeShadows,
  McpConfig,
  McpToolsConfig,
  McpAuthConfig,
  ListMcpConfig,
  McpCustomTool,
  FileMetadata,
  ImageMetadata,
  ImageTransformationResult,
  Plugin,
  PluginContext,
  GeneratedFiles,
  ResolveInputHookArgs,
  ValidateHookArgs,
  BeforeOperationHookArgs,
  AfterOperationHookArgs,
  FieldResolveInputHookArgs,
  FieldValidateHookArgs,
  FieldBeforeOperationHookArgs,
  FieldAfterOperationHookArgs,
  FieldResolveOutputHookArgs,
} from './types.js'
