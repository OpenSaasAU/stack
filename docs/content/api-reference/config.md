# Config API Reference

Complete API reference for the OpenSaaS Stack configuration system. For basic usage and examples, see the [Config System guide](/docs/core-concepts/config).

## Core Functions

### `config()`

Creates and validates an OpenSaaS Stack configuration. Executes plugins if provided.

```typescript
import { config } from '@opensaas/stack-core'

export default config({
  db: {
    /* ... */
  },
  lists: {
    /* ... */
  },
  // ... other options
})
```

**Parameters:**

- `userConfig: OpenSaasConfig` - The configuration object

**Returns:**

- `OpenSaasConfig | Promise<OpenSaasConfig>` - Synchronous if no plugins, async if plugins are present

### `list()`

Defines a list (data model) with type-safe field definitions, access control, and hooks.

```typescript
import { list } from '@opensaas/stack-core'

User: list({
  fields: {
    /* ... */
  },
  access: {
    /* ... */
  },
  hooks: {
    /* ... */
  },
})
```

**Type Parameter:**

- `T` - The TypeScript type of items in this list (optional, auto-inferred from generated types)

**Parameters:**

- `config: object` - List configuration object

**Returns:**

- `ListConfig<T>` - Typed list configuration

---

## Configuration Types

### `OpenSaasConfig`

The root configuration object for your OpenSaaS Stack application.

```typescript
export default config({
  db: DatabaseConfig,
  lists: Record<string, ListConfig>,
  session?: SessionConfig,
  ui?: UIConfig,
  mcp?: McpConfig,
  storage?: StorageConfig,
  opensaasPath?: string,
  plugins?: Plugin[],
})
```

#### Properties

##### `db` (required)

Database connection configuration.

**Type:** [`DatabaseConfig`](#databaseconfig)

##### `lists` (required)

Dictionary of list definitions. Keys must be in PascalCase (e.g., `Post`, `BlogPost`, `AuthUser`).

**Type:** `Record<string, ListConfig>`

**Example:**

```typescript
lists: {
  Post: list({ /* ... */ }),
  User: list({ /* ... */ }),
  BlogPost: list({ /* ... */ }),
}
```

##### `session`

Session configuration for authentication integration.

**Type:** [`SessionConfig`](#sessionconfig)

##### `ui`

Admin UI customization options.

**Type:** [`UIConfig`](#uiconfig)

##### `mcp`

Model Context Protocol server configuration for AI assistant integration.

**Type:** [`McpConfig`](#mcpconfig)

##### `storage`

File/image upload storage provider configuration.

**Type:** [`StorageConfig`](#storageconfig)

##### `opensaasPath`

Directory where generated files are placed (context, types, patched Prisma client).

**Type:** `string`
**Default:** `".opensaas"`

##### `plugins`

Array of plugins to extend stack functionality.

**Type:** [`Plugin[]`](#plugin)

---

### `DatabaseConfig`

Database connection and adapter configuration.

```typescript
db: {
  provider: 'postgresql' | 'mysql' | 'sqlite',
  prismaClientConstructor: (PrismaClientClass: any) => any,
}
```

#### Properties

##### `provider` (required)

Database type.

**Type:** `'postgresql' | 'mysql' | 'sqlite'`

##### `prismaClientConstructor` (required)

Factory function that creates a Prisma client instance with a database adapter. **Required in Prisma 7** - all database connections must use adapters.

The database connection URL is passed directly to the adapter, not to the OpenSaas config.

**Type:** `(PrismaClientClass: any) => any`

**Example - SQLite:**

```typescript
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

db: {
  provider: 'sqlite',
  prismaClientConstructor: (PrismaClient) => {
    const db = new Database(process.env.DATABASE_URL || './dev.db')
    const adapter = new PrismaBetterSQLite3(db)
    return new PrismaClient({ adapter })
  }
}
```

**Example - PostgreSQL (Neon):**

```typescript
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

db: {
  provider: 'postgresql',
  prismaClientConstructor: (PrismaClient) => {
    neonConfig.webSocketConstructor = ws
    const adapter = new PrismaNeon({
      connectionString: process.env.DATABASE_URL
    })
    return new PrismaClient({ adapter })
  }
}
```

---

### `ListConfig`

Configuration for a single list (data model).

```typescript
list({
  fields: Record<string, FieldConfig>,
  access?: {
    operation?: OperationAccess
  },
  hooks?: Hooks,
  mcp?: ListMcpConfig,
})
```

#### Properties

##### `fields` (required)

Field definitions for this list. Keys are field names (camelCase recommended).

**Type:** `Record<string, FieldConfig>`

**See:** [Field Types guide](/docs/core-concepts/field-types) for available field types

##### `access`

Access control rules for this list.

**Type:** `{ operation?: OperationAccess }`

**See:** [Access Control guide](/docs/core-concepts/access-control)

##### `hooks`

List-level hooks for data transformation and side effects.

**Type:** [`Hooks`](#hooks)

**See:** [Hooks guide](/docs/core-concepts/hooks)

##### `mcp`

Model Context Protocol configuration for this list.

**Type:** [`ListMcpConfig`](#listmcpconfig)

---

### `OperationAccess`

Operation-level access control rules.

```typescript
access: {
  operation: {
    query?: AccessControl,
    create?: AccessControl,
    update?: AccessControl,
    delete?: AccessControl,
  }
}
```

#### Properties

Each operation accepts an `AccessControl` function that returns:

- `true` - Allow access
- `false` - Deny access
- `PrismaFilter` - Prisma where clause to filter accessible records

**Type:** `AccessControl<T>`

**Function signature:**

```typescript
;(args: {
  session: Session
  item?: T // Present for update/delete
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>
```

**Examples:**

```typescript
// Boolean: Allow all authenticated users to query
query: ({ session }) => !!session

// Filter: Users can only update their own posts
update: ({ session, item }) => session?.userId === item.authorId

// Filter object: Scope access to specific records
query: ({ session }) => ({
  authorId: { equals: session?.userId },
})
```

---

### `Hooks`

List-level hooks for data transformation and side effects.

```typescript
hooks: {
  resolveInput?: (args: HookArgs) => Promise<Partial<T>>,
  validateInput?: (args: HookArgs & { addValidationError: (msg: string) => void }) => Promise<void>,
  beforeOperation?: (args: HookArgs) => Promise<void>,
  afterOperation?: (args: HookArgs) => Promise<void>,
}
```

#### Hook Types

##### `resolveInput`

Transform input data before validation and database write.

**When called:** During `create` and `update` operations

**Use cases:** Auto-populate fields, set defaults, normalize data

**Example:**

```typescript
resolveInput: async ({ resolvedData, operation }) => {
  // Auto-set publishedAt when status changes to published
  if (resolvedData.status === 'published' && !resolvedData.publishedAt) {
    resolvedData.publishedAt = new Date()
  }
  return resolvedData
}
```

##### `validateInput`

Custom validation logic beyond field-level validation rules.

**When called:** During `create` and `update` operations, after `resolveInput`

**Use cases:** Cross-field validation, business logic validation

**Example:**

```typescript
validateInput: async ({ resolvedData, addValidationError }) => {
  if (resolvedData.endDate < resolvedData.startDate) {
    addValidationError('End date must be after start date')
  }
}
```

##### `beforeOperation`

Side effects before database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete` operations

**Use cases:** Logging, notifications, pre-operation checks

**Example:**

```typescript
beforeOperation: async ({ operation, item, context }) => {
  await auditLog.record({
    operation,
    userId: context.session?.userId,
    itemId: item?.id,
  })
}
```

##### `afterOperation`

Side effects after database operation. Does NOT modify data.

**When called:** After `create`, `update`, or `delete` operations

**Use cases:** Cache invalidation, webhooks, post-operation cleanup

**Example:**

```typescript
afterOperation: async ({ operation, item, context }) => {
  await invalidateCache(`post:${item.id}`)
  await sendWebhook({ event: `post.${operation}`, data: item })
}
```

#### `HookArgs`

Arguments passed to hook functions.

```typescript
type HookArgs<T> = {
  operation: 'create' | 'update' | 'delete'
  resolvedData?: Partial<T> // Input data (not present for delete)
  item?: T // Existing item (for update/delete)
  context: AccessContext
}
```

---

### `FieldConfig`

Base configuration for all field types. Each field type extends this with type-specific options.

```typescript
type BaseFieldConfig = {
  type: string
  access?: FieldAccess
  defaultValue?: unknown
  hooks?: FieldHooks
  typePatch?: TypePatchConfig
  ui?: object
}
```

#### Common Properties

##### `type` (required)

Field type identifier (e.g., `'text'`, `'integer'`, `'relationship'`).

**Type:** `string`

##### `access`

Field-level access control.

**Type:** [`FieldAccess`](#fieldaccess)

**Example:**

```typescript
internalNotes: text({
  access: {
    read: ({ session }) => session?.role === 'admin',
    create: ({ session }) => session?.role === 'admin',
    update: ({ session }) => session?.role === 'admin',
  },
})
```

##### `defaultValue`

Default value when creating new items.

**Type:** Varies by field type

##### `hooks`

Field-level hooks for data transformation.

**Type:** [`FieldHooks`](#fieldhooks)

##### `typePatch`

Configuration for patching Prisma-generated TypeScript types (advanced).

**Type:** [`TypePatchConfig`](#typepatchconfig)

##### `ui`

UI-specific configuration passed to field components.

**Type:** `object`

**Common UI options:**

- `component?: React.Component` - Custom field component
- `fieldType?: string` - Reference to globally registered field type
- `valueForClientSerialization?: (args) => unknown` - Transform value before sending to browser

---

### `FieldAccess`

Field-level access control rules.

```typescript
access: {
  read?: AccessControl,
  create?: AccessControl,
  update?: AccessControl,
}
```

#### Properties

Each property accepts an `AccessControl` function that returns `true` (allow) or `false` (deny).

**Example:**

```typescript
password: password({
  access: {
    // Never allow reading password field
    read: () => false,
    // Only admins can set passwords
    create: ({ session }) => session?.role === 'admin',
    update: ({ session }) => session?.role === 'admin',
  },
})
```

---

### `FieldHooks`

Field-level hooks for data transformation and side effects.

```typescript
hooks: {
  resolveInput?: (args) => Promise<TInput | undefined> | TInput | undefined,
  resolveOutput?: (args) => TOutput | undefined,
  beforeOperation?: (args) => Promise<void> | void,
  afterOperation?: (args) => Promise<void> | void,
}
```

#### Hook Types

##### `resolveInput`

Transform field value before database write.

**When called:** During `create` and `update` operations

**Use cases:** Hash passwords, normalize data, transform input format

**Example:**

```typescript
password: password({
  hooks: {
    resolveInput: async ({ inputValue }) => {
      if (typeof inputValue === 'string' && inputValue.length > 0) {
        return await bcrypt.hash(inputValue, 10)
      }
      return inputValue
    },
  },
})
```

##### `resolveOutput`

Transform field value after database read.

**When called:** During `query` operations

**Use cases:** Wrap sensitive data, format values, compute derived values

**Example:**

```typescript
password: password({
  hooks: {
    resolveOutput: ({ value }) => {
      return new HashedPassword(value) // Wrap to prevent accidental exposure
    },
  },
})
```

##### `beforeOperation`

Side effects before database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete` operations

**Example:**

```typescript
profileImage: text({
  hooks: {
    beforeOperation: async ({ operation, resolvedValue }) => {
      console.log(`About to ${operation} profile image:`, resolvedValue)
    },
  },
})
```

##### `afterOperation`

Side effects after database operation. Does NOT modify data.

**When called:** After `create`, `update`, `delete`, or `query` operations

**Example:**

```typescript
thumbnail: text({
  hooks: {
    afterOperation: async ({ operation, value, item }) => {
      if (operation === 'delete') {
        await deleteFromCDN(value) // Cleanup on delete
      }
    },
  },
})
```

---

### `SessionConfig`

Session management configuration.

```typescript
session: {
  getSession: () => Promise<Session>
}
```

#### Properties

##### `getSession` (required)

Function that retrieves the current session.

**Type:** `() => Promise<Session>`

**Example:**

```typescript
import { auth } from '@/lib/auth'

session: {
  getSession: async () => {
    const session = await auth()
    return session?.user ? { userId: session.user.id } : null
  }
}
```

---

### `UIConfig`

Admin UI customization options.

```typescript
ui: {
  basePath?: string,
  theme?: ThemeConfig,
}
```

#### Properties

##### `basePath`

Base URL path for admin UI routes.

**Type:** `string`
**Default:** `"/admin"`

##### `theme`

Theme customization options.

**Type:** [`ThemeConfig`](#themeconfig)

---

### `ThemeConfig`

Theme customization for the admin UI.

```typescript
theme: {
  preset?: 'modern' | 'classic' | 'neon',
  colors?: ThemeColors,
  darkColors?: ThemeColors,
  radius?: number,
}
```

#### Properties

##### `preset`

Predefined theme preset.

**Type:** `'modern' | 'classic' | 'neon'`
**Default:** `'modern'`

##### `colors`

Custom color overrides for light mode.

**Type:** [`ThemeColors`](#themecolors)

##### `darkColors`

Custom color overrides for dark mode.

**Type:** [`ThemeColors`](#themecolors)

##### `radius`

Border radius in rem units.

**Type:** `number`
**Default:** `0.75`

---

### `ThemeColors`

Custom theme color values (HSL format without `hsl()` wrapper).

```typescript
colors: {
  background?: string,        // e.g., "220 20% 97%"
  foreground?: string,
  primary?: string,
  primaryForeground?: string,
  secondary?: string,
  // ... more color options
}
```

**Format:** HSL values as string: `"hue saturation% lightness%"`

**Example:**

```typescript
theme: {
  colors: {
    primary: "221 83% 53%",           // Blue
    primaryForeground: "0 0% 100%",   // White
    background: "220 20% 97%",        // Light gray
  }
}
```

#### Available Colors

- `background` - Main background color
- `foreground` - Main text color
- `card` - Card background
- `cardForeground` - Card text
- `popover` - Popover background
- `popoverForeground` - Popover text
- `primary` - Primary action color
- `primaryForeground` - Primary action text
- `secondary` - Secondary action color
- `secondaryForeground` - Secondary action text
- `muted` - Muted background
- `mutedForeground` - Muted text
- `accent` - Accent color
- `accentForeground` - Accent text
- `destructive` - Destructive action color
- `destructiveForeground` - Destructive action text
- `border` - Border color
- `input` - Input border color
- `ring` - Focus ring color
- `gradientFrom` - Gradient start color
- `gradientTo` - Gradient end color

---

### `McpConfig`

Model Context Protocol server configuration for AI assistant integration.

```typescript
mcp: {
  enabled?: boolean,
  basePath?: string,
  auth?: McpAuthConfig,
  defaultTools?: McpToolsConfig,
  resource?: string,
}
```

#### Properties

##### `enabled`

Enable MCP server globally.

**Type:** `boolean`
**Default:** `false`

##### `basePath`

Base path for MCP API routes.

**Type:** `string`
**Default:** `"/api/mcp"`

##### `auth`

Authentication configuration (required when MCP is enabled).

**Type:** [`McpAuthConfig`](#mcpauthconfig)

##### `defaultTools`

Default CRUD tool configuration for all lists.

**Type:** [`McpToolsConfig`](#mcptoolsconfig)

##### `resource`

OAuth resource identifier for protected resource metadata.

**Type:** `string`
**Default:** `"https://yourdomain.com"`

---

### `McpAuthConfig`

OAuth configuration for MCP authentication.

#### Better Auth Integration

```typescript
mcp: {
  auth: {
    type: 'better-auth',
    loginPage: string,
    scopes?: string[],
    oidcConfig?: {
      codeExpiresIn?: number,
      accessTokenExpiresIn?: number,
      refreshTokenExpiresIn?: number,
      defaultScope?: string,
      scopes?: string[],
    }
  }
}
```

**Example:**

```typescript
mcp: {
  enabled: true,
  auth: {
    type: 'better-auth',
    loginPage: '/sign-in',
    scopes: ['openid', 'profile', 'email'],
  }
}
```

#### Custom Auth Provider

```typescript
mcp: {
  auth: {
    type: string,
    // Additional provider-specific configuration
  }
}
```

---

### `ListMcpConfig`

List-level MCP configuration to control tool generation.

```typescript
mcp: {
  enabled?: boolean,
  tools?: McpToolsConfig,
  customTools?: McpCustomTool[],
}
```

#### Properties

##### `enabled`

Enable MCP tools for this list.

**Type:** `boolean`
**Default:** `true`

##### `tools`

Configure which CRUD tools to enable.

**Type:** [`McpToolsConfig`](#mcptoolsconfig)

##### `customTools`

Custom MCP tools specific to this list.

**Type:** [`McpCustomTool[]`](#mcpcustomtool)

---

### `McpToolsConfig`

Configuration for which CRUD tools to enable.

```typescript
tools: {
  read?: boolean,    // Default: true
  create?: boolean,  // Default: true
  update?: boolean,  // Default: true
  delete?: boolean,  // Default: true
}
```

**Example:**

```typescript
Post: list({
  mcp: {
    tools: {
      read: true,
      create: true,
      update: true,
      delete: false, // Disable delete tool for safety
    },
  },
})
```

---

### `McpCustomTool`

Custom MCP tool definition for specialized operations.

```typescript
type McpCustomTool = {
  name: string
  description: string
  inputSchema: ZodSchema
  handler: (args) => Promise<unknown>
}
```

**Example:**

```typescript
import { z } from 'zod'

customTools: [
  {
    name: 'publish-post',
    description: 'Publish a draft post and notify subscribers',
    inputSchema: z.object({
      postId: z.string(),
      notifySubscribers: z.boolean().optional(),
    }),
    handler: async ({ input, context }) => {
      const post = await context.db.post.update({
        where: { id: input.postId },
        data: { status: 'published', publishedAt: new Date() },
      })

      if (input.notifySubscribers) {
        await notifySubscribers(post)
      }

      return post
    },
  },
]
```

---

### `StorageConfig`

File/image upload storage provider configuration.

```typescript
storage: Record<string, StorageProviderConfig>
```

Maps provider names to their configurations.

**Example:**

```typescript
import { s3Storage, localStorage } from '@opensaas/stack-storage'

storage: {
  avatars: s3Storage({
    bucket: 'my-avatars',
    region: 'us-east-1',
  }),
  documents: localStorage({
    uploadDir: './uploads',
    serveUrl: '/api/files',
  }),
}
```

---

### `TypePatchConfig`

Configuration for patching Prisma-generated TypeScript types (advanced use).

```typescript
typePatch: {
  resultType: string,
  patchScope?: 'scalars-only' | 'all',
}
```

#### Properties

##### `resultType` (required)

TypeScript import statement for the type to use in Prisma result types.

**Type:** `string`

**Format:** `"import('@package/name').TypeName"`

##### `patchScope`

Where to apply the type patch.

**Type:** `'scalars-only' | 'all'`
**Default:** `'scalars-only'`

**Example:**

```typescript
password: password({
  typePatch: {
    resultType: "import('@opensaas/stack-core').HashedPassword",
    patchScope: 'scalars-only',
  },
})
```

---

## Plugin System

### `Plugin`

Plugin definition for extending stack functionality.

```typescript
type Plugin = {
  name: string
  version?: string
  dependencies?: string[]
  init: (context: PluginContext) => void | Promise<void>
  beforeGenerate?: (config: OpenSaasConfig) => OpenSaasConfig | Promise<OpenSaasConfig>
  afterGenerate?: (files: GeneratedFiles) => GeneratedFiles | Promise<GeneratedFiles>
  runtime?: (context: AccessContext) => unknown
}
```

#### Properties

##### `name` (required)

Unique plugin identifier.

**Type:** `string`

##### `version`

Semantic version string.

**Type:** `string`

##### `dependencies`

Array of plugin names this plugin depends on.

**Type:** `string[]`

**Example:**

```typescript
dependencies: ['auth'] // This plugin requires auth plugin to run first
```

##### `init` (required)

Main initialization hook. Called during config processing.

**Type:** `(context: PluginContext) => void | Promise<void>`

**Example:**

```typescript
init: async (context) => {
  // Add new list
  context.addList(
    'MyList',
    list({
      fields: { name: text() },
    }),
  )

  // Extend existing list
  context.extendList('User', {
    fields: { myField: text() },
  })

  // Store plugin data
  context.setPluginData('my-plugin', { apiKey: '...' })
}
```

##### `beforeGenerate`

Hook called before Prisma schema generation. Allows config transformation.

**Type:** `(config: OpenSaasConfig) => OpenSaasConfig | Promise<OpenSaasConfig>`

##### `afterGenerate`

Hook called after file generation. Allows post-processing generated files.

**Type:** `(files: GeneratedFiles) => GeneratedFiles | Promise<GeneratedFiles>`

##### `runtime`

Provides runtime services attached to context.

**Type:** `(context: AccessContext) => unknown`

**Example:**

```typescript
runtime: (context) => ({
  sendEmail: async (to, subject, body) => {
    // Email service implementation
  },
})

// Access in your app:
// context.plugins.myPlugin.sendEmail(...)
```

---

### `PluginContext`

Context provided to plugins during initialization.

```typescript
type PluginContext = {
  readonly config: OpenSaasConfig
  addList: (name: string, listConfig: ListConfig) => void
  extendList: (name: string, extension: object) => void
  registerFieldType?: (type: string, builder: Function) => void
  registerMcpTool?: (tool: McpCustomTool) => void
  setPluginData: <T>(pluginName: string, data: T) => void
}
```

#### Methods

##### `addList()`

Add a new list to the config. Throws if list already exists.

**Signature:**

```typescript
addList(name: string, listConfig: ListConfig): void
```

##### `extendList()`

Extend an existing list with additional fields, hooks, or access control. Deep merges configuration.

**Signature:**

```typescript
extendList(name: string, extension: {
  fields?: Record<string, FieldConfig>,
  hooks?: Hooks,
  access?: { operation?: OperationAccess },
  mcp?: ListMcpConfig,
}): void
```

##### `registerFieldType()`

Register a custom field type globally.

**Signature:**

```typescript
registerFieldType(type: string, builder: (options?: unknown) => BaseFieldConfig): void
```

##### `registerMcpTool()`

Register a custom MCP tool globally.

**Signature:**

```typescript
registerMcpTool(tool: McpCustomTool): void
```

##### `setPluginData()`

Store plugin-specific data for runtime access.

**Signature:**

```typescript
setPluginData<T>(pluginName: string, data: T): void
```

**Access at runtime:**

```typescript
const pluginData = config._pluginData[pluginName]
```

---

## Runtime Context

### `AccessContext`

Context object passed to access control functions, hooks, and custom tools.

```typescript
type AccessContext = {
  session: Session
  prisma: PrismaClient
  db: AccessControlledDB
  storage: StorageUtils
  plugins: Record<string, unknown>
  _isSudo: boolean
}
```

#### Properties

##### `session`

Current user session (user-defined structure).

**Type:** `Session | null`

##### `prisma`

Raw Prisma client (bypasses access control - use with caution).

**Type:** `PrismaClient`

##### `db`

Access-controlled database interface (enforces access rules).

**Type:** `AccessControlledDB`

##### `storage`

File/image upload utilities.

**Type:** [`StorageUtils`](#storageutils)

##### `plugins`

Plugin-provided runtime services.

**Type:** `Record<string, unknown>`

##### `_isSudo`

Internal flag for sudo mode (bypasses all access control).

**Type:** `boolean`

---

### `StorageUtils`

Storage utilities for file/image uploads.

```typescript
type StorageUtils = {
  uploadFile: (providerName, file, buffer, options?) => Promise<FileMetadata>
  uploadImage: (providerName, file, buffer, options?) => Promise<ImageMetadata>
  deleteFile: (providerName, filename) => Promise<void>
  deleteImage: (metadata) => Promise<void>
}
```

---

## Next Steps

- **[Field Types](/docs/core-concepts/field-types)** - Detailed field type reference
- **[Access Control](/docs/core-concepts/access-control)** - Access control patterns
- **[Hooks](/docs/core-concepts/hooks)** - Hook execution and examples
- **[Plugins](/docs/guides/plugins)** - Creating custom plugins
