# Writing Plugins

Stack's plugin system allows you to extend functionality by adding lists, transforming configs, registering custom tools, and more. This guide covers everything you need to create powerful, reusable plugins.

## Overview

Plugins enable you to:

1. **Inject Lists** - Add auto-generated lists (e.g., User, Session from auth plugin)
2. **Extend Lists** - Add fields or hooks to existing user-defined lists
3. **Transform Config** - Modify configuration before schema generation
4. **Register Tools** - Add custom MCP tools for AI assistants
5. **Post-Process** - Modify generated files after creation
6. **Provide Runtime Services** - Expose utilities available in access control and hooks

## When to Create a Plugin

Consider creating a plugin when you need to:

- **Add reusable functionality** - Authentication, file storage, analytics
- **Package third-party integrations** - Payment processors, email services, CMS features
- **Enforce organizational standards** - Audit logging, security policies, data governance
- **Automate repetitive setup** - Common field patterns, access control templates
- **Extend stack capabilities** - Custom field types, validation rules, generators

## Plugin Structure

### Basic Plugin Interface

```typescript
import type { Plugin } from '@opensaas/stack-core/extend'

export function myPlugin(options: MyPluginOptions): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    dependencies: [], // Optional: other plugins this depends on

    init: async (context) => {
      // Initialize plugin, add lists, extend config
    },

    beforeGenerate: async (config) => {
      // Transform config before schema generation (optional)
      return config
    },

    afterGenerate: async (files) => {
      // Post-process generated files (optional)
      return files
    },

    runtime: (context, sudo) => {
      // Provide runtime services (optional)
      return {
        myUtility: async () => {
          /* ... */
        },
      }
    },
  }
}
```

### Plugin Context API

The `context` object passed to `init()` provides these members:

| Member                              | What it does                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`                            | The current config, read-only. Modify it through the methods below, never by mutation.                                                            |
| `addList(name, listConfig)`         | Add a new list. Throws if the name is taken.                                                                                                      |
| `extendList(name, extension)`       | Merge `fields`, `hooks` or `mcp` into an existing list. Throws if the list does not exist.                                                        |
| `addExtension({ name, from })`      | Declare a Postgres extension pack the plugin's field types need, as if the app had listed it under `db.extensions`. Idempotent for the same pair. |
| `registerFieldType?(type, builder)` | Register a field builder globally, for third-party field packages.                                                                                |
| `registerMcpTool?(tool)`            | Register a custom MCP tool on the global server.                                                                                                  |
| `setPluginData(pluginName, data)`   | Store data on the config for the plugin's own runtime to read back.                                                                               |

`extendList` refuses an extension that carries `access.operation` at all —
throwing, not merging. Access control belongs to whoever created the list, never
to a plugin extending it ([ADR-0013](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0013-access-control-belongs-to-the-application-not-plugins.md)).
A list the plugin creates itself with `addList` declares its own access as
normal.

## Plugin Lifecycle

### 1. Initialization (`init`)

Called during config processing. Use this to add or extend lists.

```typescript
init: async (context) => {
  // Add a new list
  context.addList(
    'AuditLog',
    list({
      fields: {
        action: text({ validation: { isRequired: true } }),
        userId: text(),
        timestamp: timestamp({ defaultValue: { kind: 'now' } }),
      },
    }),
  )

  // Extend existing User list (if it exists)
  if (context.config.lists.User) {
    context.extendList('User', {
      fields: {
        lastLoginAt: timestamp(),
      },
    })
  }

  // Store plugin config for runtime access
  context.setPluginData('my-plugin', options)
}
```

### 2. Before Generation (`beforeGenerate`)

Transform the full config before the Contract module is derived from it. Adding
a field to every list:

```typescript
beforeGenerate: async (config) => {
  for (const listConfig of Object.values(config.lists)) {
    listConfig.fields.createdBy = text()
  }

  return config
}
```

### 3. After Generation (`afterGenerate`)

Post-process the generated files. This runs **before** `prisma contract emit`,
so a rewritten Contract module is the one the emitted `contract.json` and
`contract.d.ts` describe — and a rewrite the contract toolchain rejects fails
`opensaas generate` rather than landing on disk unemitted.

```typescript
afterGenerate: async (files) => {
  files['custom-output.ts'] = generateCustomFile()

  return files
}
```

### 4. Runtime Services (`runtime`)

Provide utilities accessible in access control and hooks. The factory takes two
arguments: the request's `AccessContext`, and a `sudo()` that returns an
access-bypassing (but still hook-firing) context for the same request. Reach for
`sudo()` when the service must not depend on the caller's own list access — an
identity lookup, or an audit trail the audited session could otherwise scope
away.

```typescript
runtime: (context, sudo) => ({
  sendEmail: async (to: string, subject: string, body: string) => {
    // Email service implementation
  },
  whoAmI: async () => {
    const userId = context.session?.userId
    if (typeof userId !== 'string') return null
    return sudo()
      .db.User.where({ id: { equals: userId } })
      .first()
  },
})
```

The return value lands on `context.plugins.<pluginName>`, so an app calls
`context.plugins.audit.getAuditTrail(…)`.

## Real-World Example: Audit Plugin

A complete audit logging plugin.
`AuditLog` is readable by admins and writable by nobody: `create` is denied on
the secured surface too, so the only way a row lands there is the plugin's own
elevated write. `afterOperation` is a union discriminated on `operation`, so the
hook narrows before it reaches for `item` or `originalItem`.

```typescript
// audit-plugin.ts
import { list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import type { Plugin } from '@opensaas/stack-core/extend'

export interface AuditPluginConfig {
  excludeLists?: string[]
}

export function auditPlugin(options: AuditPluginConfig = {}): Plugin {
  const { excludeLists = [] } = options

  return {
    name: 'audit',
    version: '0.1.0',

    init: async (context) => {
      context.addList(
        'AuditLog',
        list({
          fields: {
            listName: text({ validation: { isRequired: true } }),
            itemId: text(),
            operation: text({ validation: { isRequired: true } }),
            userId: text(),
            changes: text(),
            recordedAt: timestamp({ defaultValue: { kind: 'now' } }),
          },
          access: {
            operation: {
              query: ({ session }) => session?.role === 'admin',
              create: () => false,
              update: () => false,
              delete: () => false,
            },
          },
        }),
      )

      for (const listName of Object.keys(context.config.lists)) {
        if (excludeLists.includes(listName)) continue

        context.extendList(listName, {
          hooks: {
            afterOperation: async (args) => {
              const row = args.operation === 'delete' ? args.originalItem : args.item
              const ctx = args.context
              const collection = ormCollection(ctx.ormHandle, 'AuditLog')

              await collection.create({
                listName,
                itemId: typeof row.id === 'string' ? row.id : '',
                operation: args.operation,
                userId: String(ctx.session?.userId ?? 'anonymous'),
                changes: JSON.stringify(row),
              })
            },
          },
        })
      }

      context.setPluginData('audit', options)
    },

    runtime: (_context, sudo) => ({
      getAuditTrail: async (listName: string, itemId: string) => {
        return sudo()
          .db.AuditLog.where({ listName: { equals: listName }, itemId: { equals: itemId } })
          .orderBy({ recordedAt: 'desc' })
          .all()
      },
    }),
  }
}
```

#### Which database handle does a plugin get?

The `context` a hook or a `runtime()` factory receives is an `AccessContext`, and
it carries two database surfaces. Neither is `context.unsafe`: an
`AccessContext` has **no `unsafe` member**. That one lives on the request
context an application holds (`StackBaseContext`), and the
[Context API reference](/docs/reference/context-api) covers it.

- **`context.db`** — the secured surface, keyed by PascalCase list name. Access
  control, Field Visibility and hooks all apply, and every terminal is nullable
  or empty on denial. Reach for this by default.
- **`context.ormHandle`** — the engine's own ORM handle: the map of list key to
  Prisma collection that `context.db` runs its own queries through. It enforces
  **nothing** — no access control, no Field Visibility, no `resolveOutput`, no
  computed fields, no hooks, and no error normalisation, so a failure arrives as
  the raw driver error rather than a `DatabaseError`. It is engine plumbing, and
  a plugin that reaches for it is opting out of the same guarantees
  `context.unsafe` opts out of. Say why at the call site.

`ormHandle` is keyed by **list key**, so it is `ormHandle.AuditLog`, never
`ormHandle.auditLog`. Its values are Prisma 8 collections typed as `unknown`,
because the per-list types belong to the generated bundle — a plugin that uses
one narrows it itself:

```typescript
import type { OrmClient } from '@opensaas/stack-core'

interface OrmCollection {
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>
}

function isOrmCollection(value: unknown): value is OrmCollection {
  if (typeof value !== 'object' || value === null) return false
  return typeof Reflect.get(value, 'create') === 'function'
}

function ormCollection(handle: OrmClient, listKey: string): OrmCollection {
  const collection = handle[listKey]
  if (!isOrmCollection(collection)) {
    throw new Error(`The ORM client exposes no collection for "${listKey}".`)
  }
  return collection
}
```

The plugin above pays that cost for its hook, where there is no `sudo()` to
reach for, and takes the typed `sudo().db` path in `runtime()`, where there is.

The Write Pipeline rebinds `ormHandle` wherever it rebinds `context.db`, so the
two are always in the same transaction state as each other. Every write opens a
transaction ([ADR-0010](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0010-nested-writes-decompose-into-a-single-transaction.md)),
so database work a `beforeOperation`/`afterOperation` hook does through either
handle **is** rolled back when the write fails.

### Using the Audit Plugin

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { auditPlugin } from './plugins/audit-plugin'

export default config({
  plugins: [
    auditPlugin({
      excludeLists: ['AuditLog', 'Session'],
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text(),
        content: text(),
      },
      access: { operation: { query: () => true } },
    }),
  },
})
```

`postgresql` is the only provider, and the connection string is not part of the
config: it is resolved from `DIRECT_DATABASE_URL`, `DATABASE_URL` or the running
dev database. See the [deployment guide](/docs/how-to/deploy).

### Accessing Audit Trail

Reach the plugin's services on `context.plugins.<pluginName>`, from a server
action or a route handler:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: 'user-123' })
const auditTrail = await context.plugins.audit.getAuditTrail('Post', postId)
```

## Plugin Dependency Resolution

Plugins can depend on other plugins. The stack automatically orders execution using topological sort.

```typescript
export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    dependencies: ['auth'], // This plugin requires auth plugin

    init: async (context) => {
      // Auth plugin has already run
      // User list exists and has auth fields

      context.extendList('User', {
        fields: {
          apiKey: text(), // Add to existing User from auth
        },
      })
    },
  }
}
```

### Dependency Rules

1. **Dependencies run first** - Plugins are executed in dependency order
2. **Circular dependencies fail** - Stack will throw error on circular deps
3. **Missing dependencies fail** - Stack validates all dependencies exist
4. **Version conflicts** - No automatic resolution (yet)

## Advanced Patterns

### Hook Chaining

Multiple plugins can add hooks to the same list. They execute in plugin order —
below, `normalise` first, then `validation`:

```typescript
export function normalisePlugin(): Plugin {
  return {
    name: 'normalise',
    init: async (context) => {
      for (const listName of Object.keys(context.config.lists)) {
        context.extendList(listName, {
          hooks: {
            resolveInput: async ({ resolvedData }) => {
              if (typeof resolvedData.title === 'string') {
                resolvedData.title = resolvedData.title.trim()
              }
              return resolvedData
            },
          },
        })
      }
    },
  }
}

export function validationPlugin(): Plugin {
  return {
    name: 'validation',
    init: async (context) => {
      for (const listName of Object.keys(context.config.lists)) {
        context.extendList(listName, {
          hooks: {
            validate: async (args) => {
              if (args.operation === 'delete') return
              if (args.resolvedData.spam) {
                args.addValidationError('Spam detected')
              }
            },
          },
        })
      }
    },
  }
}
```

Don't reach for a `resolveInput` hook to maintain `createdAt`/`updatedAt` — set
`db: { timestamps: true }` and the generator emits both, with `createdAt`
defaulted in the database and `updatedAt` maintained by the write pipeline.

### Conditional List Extension

Only extend lists if they exist:

```typescript
init: async (context) => {
  // Only extend User if it exists
  if (context.config.lists.User) {
    context.extendList('User', {
      fields: { apiKey: text() },
    })
  }

  // Only extend lists with specific field
  for (const [listName, listConfig] of Object.entries(context.config.lists)) {
    if (listConfig.fields.authorId) {
      context.extendList(listName, {
        fields: {
          publishedAt: timestamp(),
        },
      })
    }
  }
}
```

### Custom Field Types

A field builder describes its column through `getContractField`, and its
TypeScript faces through `outputType` and `inputType`. The builder the plugin
registers takes `unknown`, so narrow the options rather than spreading them:

```typescript
init: async (context) => {
  context.registerFieldType?.('geolocation', (options) => {
    const base = typeof options === 'object' && options !== null ? options : {}

    return {
      ...base,
      type: 'geolocation',
      getZodSchema: () => z.object({ lat: z.number(), lng: z.number() }),
      getContractField: (fieldName: string) => ({
        kind: 'column',
        name: fieldName,
        type: { pack: 'pg', type: 'jsonb' },
        nullable: false,
      }),
      outputType: '{ lat: number; lng: number }',
      inputType: '{ lat: number; lng: number }',
    }
  })
}
```

A field type that needs a Postgres extension declares it in the same `init`, so
an app gets the pack by using the field rather than by remembering to list it:

```typescript
init: async (context) => {
  context.addExtension({ name: 'pgvector', from: '@prisma/orm-extension-pgvector' })
}
```

### MCP Tool Registration

Register custom MCP tools for AI assistants:

```typescript
init: async (context) => {
  context.registerMcpTool?.({
    name: 'send-email',
    description: 'Send email to user',
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    handler: async ({ input, context }) => {
      // Send email implementation
      return { success: true }
    },
  })
}
```

## Plugin Configuration Patterns

### Type-Safe Options

Use TypeScript for plugin configuration:

```typescript
export interface MyPluginOptions {
  apiKey: string
  endpoint?: string
  retries?: number
}

export function myPlugin(options: MyPluginOptions): Plugin {
  const { apiKey, endpoint = 'https://api.example.com', retries = 3 } = options

  return {
    name: 'my-plugin',
    // ...
  }
}
```

### Validation

Validate plugin options early:

```typescript
export function myPlugin(options: MyPluginOptions): Plugin {
  if (!options.apiKey) {
    throw new Error('myPlugin: apiKey is required')
  }

  if (options.retries && options.retries < 0) {
    throw new Error('myPlugin: retries must be positive')
  }

  return {/* ... */}
}
```

### Environment Variables

Use environment variables for secrets:

```typescript
export function myPlugin(options?: { apiKey?: string }): Plugin {
  const apiKey = options?.apiKey || process.env.MY_PLUGIN_API_KEY

  if (!apiKey) {
    throw new Error('myPlugin: API key not found')
  }

  return {/* ... */}
}
```

## Testing Plugins

### Unit Testing

Test plugin initialization and behavior:

````typescript
import { describe, test, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { myPlugin } from './my-plugin'

`config()` returns a `Promise` when the config declares plugins, so `await` it:

```typescript
import { describe, test, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { myPlugin } from './my-plugin'

describe('myPlugin', () => {
  test('adds AuditLog list', async () => {
    const cfg = await config({
      plugins: [myPlugin()],
      db: { provider: 'postgresql' },
      lists: {},
    })

    expect(cfg.lists.AuditLog).toBeDefined()
    expect(cfg.lists.AuditLog.fields.listName).toBeDefined()
  })

  test('extends User list when present', async () => {
    const cfg = await config({
      plugins: [myPlugin()],
      db: { provider: 'postgresql' },
      lists: {
        User: list({ fields: { name: text() } }),
      },
    })

    expect(cfg.lists.User.fields.apiKey).toBeDefined()
  })
})
````

### Integration Testing

An integration test runs the plugin against a real database and reads back
through the same surfaces an application would. The audit trail is the
interesting case, because the assertion cannot use `context.db.AuditLog`: the
plugin denies `query` to everyone but an admin, which is the whole point. Reach
past the secured surface deliberately, with `context.unsafe`:

```typescript
test('audit plugin logs operations', async () => {
  const context = await getContext()

  const post = await context.db.Post.create({ data: { title: 'Test' } })
  expect(post).not.toBeNull()

  const entries = await context.unsafe.orm.public.AuditLog.where((row) =>
    row.listName.eq('Post'),
  ).all()

  expect(entries).toHaveLength(1)
  expect(entries[0].operation).toBe('create')
})
```

`context.unsafe` is the deliberate bypass on the request context, and it skips
**everything** the secured surface does: access control, Field Visibility,
`resolveOutput`, computed fields, hooks, and error normalisation — a failure
here arrives as the raw driver error, not a `DatabaseError`. It carries four
members:

| Member                                 | What it is                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsafe.orm.<namespace>.<Model>`       | Prisma's own collections, behind a marking proxy. The namespace is the schema — `public` unless the list declares a `db.schema`.                                        |
| `unsafe.sql`                           | Prisma's typed SQL builder, untouched. A plan it builds runs through `query()` or `execute()`.                                                                          |
| `unsafe.raw.sql`                       | Prisma's raw tag, used as a template tag.                                                                                                                               |
| `unsafe.query(plan)` / `execute(plan)` | The executors. `query` returns a lazy result — `AsyncIterable<Row> & PromiseLike<Row[]>`, with `toArray()` and `first()` on it. `execute` returns statement statistics. |

Hand-written SQL goes through the raw tag and one of the executors:

```typescript
const rows = await context.unsafe
  .query(context.unsafe.sql.public.AuditLog.select({ id: true, operation: true }).build())
  .toArray()

const stats = await context.unsafe.execute(
  context.unsafe.raw
    .sql`DELETE FROM "public"."AuditLog" WHERE "recordedAt" < now() - interval '90 days'`
    .affectedCount()
    .build(),
)
```

The surface hands out **neither the client nor `prepare()`/`runtime()`**, so
there is no way to compile a plan that would execute unobserved. Scoping a
statement written here is yours alone.

{% callout type="warning" %}
A plugin's own hooks and its `runtime()` factory do **not** get `context.unsafe`.
They are handed an `AccessContext`, which has no such member — their equivalent
is `context.ormHandle`, engine plumbing with exactly the same absence of
protection. `context.unsafe` is on the request context an application holds.
{% /callout %}

## Best Practices

### 1. Naming Conventions

- Use descriptive, unique plugin names
- Follow semantic versioning
- Namespace custom field types and tools

### 2. Documentation

Document your plugin thoroughly:

````typescript
/**
 * Audit Plugin for Stack
 *
 * Automatically logs all database operations to an AuditLog list.
 *
 * @example
 * ```typescript
 * plugins: [auditPlugin({ excludeLists: ['Session'] })]
 * ```
 *
 * @param options - Plugin configuration
 * @param options.excludeLists - Lists to skip audit logging
 */
export function auditPlugin(options: AuditPluginConfig): Plugin
````

### 3. Error Handling

Provide clear error messages:

```typescript
init: async (context) => {
  if (!context.config.lists.User) {
    throw new Error('myPlugin requires a User list. Please define one or use the auth plugin.')
  }
}
```

### 4. Backward Compatibility

- Don't break existing configs
- Provide migration guides for breaking changes
- Use feature flags for experimental features

### 5. Performance

- Minimize hook overhead
- Use indexes for audit logs
- Consider async operations carefully

## Real-World Plugin Examples

### 1. Auth Plugin

The official auth plugin demonstrates:

- Adding multiple lists (User, Session, Account, Verification)
- Extending user-defined User list with auth fields
- Providing runtime services (session management)
- Integration with third-party library (Better-auth)

See: `packages/auth/src/config/plugin.ts`

### 2. RAG Plugin

The RAG plugin shows:

- Adding vector search capabilities
- Embedding generation hooks
- Custom MCP tools for semantic search
- Integration with OpenAI/Cohere embeddings

See: `packages/rag/src/config/plugin.ts`

### 3. Storage Plugin

The storage plugin demonstrates:

- File upload field types
- S3 and local storage providers
- Image optimization and transforms
- Runtime file management utilities

See: `packages/storage/src/config/index.ts`

## Publishing Plugins

### Package Structure

```
my-plugin/
├── src/
│   ├── config/
│   │   ├── plugin.ts       # Plugin definition
│   │   └── types.ts        # TypeScript types
│   ├── lists/
│   │   └── index.ts        # List definitions
│   └── index.ts            # Public exports
├── package.json
├── tsconfig.json
└── README.md
```

### Package Configuration

```json
{
  "name": "@myorg/opensaas-plugin-myplugin",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "@opensaas/stack-core": "^0.1.0"
  }
}
```

### Publishing Checklist

- [ ] Clear README with examples
- [ ] Type definitions exported
- [ ] Peer dependencies declared
- [ ] Tests passing
- [ ] Examples directory
- [ ] License file
- [ ] Changelog

## Troubleshooting

### Plugin Not Running

**Problem**: Plugin init() not being called

**Solutions**:

1. Check plugin is in `plugins` array
2. Verify plugin function is being called: `plugins: [myPlugin()]`
3. Check for dependency resolution errors

### Lists Not Merging

**Problem**: Extended fields not appearing

**Solutions**:

1. Use `extendList()` not `addList()` for existing lists
2. Check list name matches exactly (PascalCase)
3. Verify plugin runs before generator

### Runtime Services Not Available

**Problem**: `context.plugins.myPlugin` is undefined

**Solutions**:

1. Ensure `runtime()` is defined in plugin
2. Check plugin data stored with `setPluginData()`
3. Verify context is using correct config

### Type Errors

**Problem**: TypeScript errors in plugin code

**Solutions**:

1. Import types from `@opensaas/stack-core`
2. Use `Plugin` type for return value
3. Check `ListConfig` and `FieldConfig` types

## Next Steps

- Explore the [auth plugin source](https://github.com/OpenSaasAU/stack/tree/main/packages/auth) for a complete example
- Read about [hooks system](/docs/concepts/hooks) for data transformation patterns
- Learn about [MCP setup](/docs/how-to/mcp) for AI assistant integration
- Check the [Plugin API reference](/docs/reference/config-api#plugin) for all available methods

## Related Documentation

- [Config System](/docs/concepts/config) - Understanding the config architecture
- [Access Control](/docs/concepts/access-control) - Securing plugin-added lists
- [Custom Fields](/docs/how-to/custom-fields) - Creating custom field types
- [Authentication](/docs/how-to/authentication) - Auth plugin usage guide
