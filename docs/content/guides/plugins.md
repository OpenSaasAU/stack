# Writing Plugins

OpenSaaS Stack's plugin system allows you to extend functionality by adding lists, transforming configs, registering custom tools, and more. This guide covers everything you need to create powerful, reusable plugins.

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
import type { Plugin } from '@opensaas/stack-core'

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

    runtime: (context) => {
      // Provide runtime services (optional)
      return {
        myUtility: async () => { /* ... */ }
      }
    }
  }
}
```

### Plugin Context API

The `context` object passed to `init()` provides these methods:

```typescript
type PluginContext = {
  readonly config: OpenSaasConfig,
  addList: (name: string, listConfig: ListConfig) => void,
  extendList: (name: string, extension: object) => void,
  registerFieldType?: (type: string, builder: Function) => void,
  registerMcpTool?: (tool: McpCustomTool) => void,
  setPluginData: <T>(pluginName: string, data: T) => void,
}
```

## Plugin Lifecycle

### 1. Initialization (`init`)

Called during config processing. Use this to add or extend lists.

```typescript
init: async (context) => {
  // Add a new list
  context.addList('AuditLog', list({
    fields: {
      action: text({ validation: { isRequired: true } }),
      userId: text(),
      timestamp: timestamp({ defaultValue: { kind: 'now' } }),
    }
  }))

  // Extend existing User list (if it exists)
  if (context.config.lists.User) {
    context.extendList('User', {
      fields: {
        lastLoginAt: timestamp(),
      }
    })
  }

  // Store plugin config for runtime access
  context.setPluginData('my-plugin', options)
}
```

### 2. Before Generation (`beforeGenerate`)

Transform the full config before Prisma schema generation.

```typescript
beforeGenerate: async (config) => {
  // Add a field to all lists
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    listConfig.fields.createdBy = text()
  }

  return config
}
```

### 3. After Generation (`afterGenerate`)

Post-process generated files.

```typescript
afterGenerate: async (files) => {
  // Modify or add generated files
  files['custom-output.ts'] = generateCustomFile()

  return files
}
```

### 4. Runtime Services (`runtime`)

Provide utilities accessible in access control and hooks.

```typescript
runtime: (context) => ({
  sendEmail: async (to: string, subject: string, body: string) => {
    // Email service implementation
  },
  logEvent: async (event: string, data: unknown) => {
    // Analytics implementation
  }
})

// Access in your app:
// context.plugins.myPlugin.sendEmail(...)
```

## Real-World Example: Audit Plugin

Let's create a complete audit logging plugin:

```typescript
// audit-plugin.ts
import { list, text, timestamp } from '@opensaas/stack-core/fields'
import type { Plugin } from '@opensaas/stack-core'

export interface AuditPluginConfig {
  excludeLists?: string[]
  logReads?: boolean
}

export function auditPlugin(options: AuditPluginConfig = {}): Plugin {
  const { excludeLists = [], logReads = false } = options

  return {
    name: 'audit',
    version: '0.1.0',

    init: async (context) => {
      // Add AuditLog list
      context.addList('AuditLog', list({
        fields: {
          listName: text({ validation: { isRequired: true } }),
          itemId: text(),
          operation: text({ validation: { isRequired: true } }),
          userId: text(),
          changes: text(), // JSON string of changes
          timestamp: timestamp({ defaultValue: { kind: 'now' } }),
        },
        access: {
          operation: {
            query: ({ session }) => session?.role === 'admin',
            create: () => true, // Hooks can always create
            update: () => false,
            delete: () => false,
          }
        }
      }))

      // Add audit hooks to all lists
      for (const [listName, listConfig] of Object.entries(context.config.lists)) {
        if (excludeLists.includes(listName)) continue

        context.extendList(listName, {
          hooks: {
            afterOperation: async ({ operation, item, context: ctx }) => {
              // Skip reads unless configured
              if (operation === 'query' && !logReads) return

              // Create audit log entry
              await ctx.prisma.auditLog.create({
                data: {
                  listName,
                  itemId: item?.id || '',
                  operation,
                  userId: ctx.session?.userId || 'anonymous',
                  changes: JSON.stringify(item),
                  timestamp: new Date(),
                }
              })
            }
          }
        })
      }

      // Store config for runtime
      context.setPluginData('audit', options)
    },

    runtime: (context) => ({
      // Provide utility to query audit logs
      getAuditTrail: async (listName: string, itemId: string) => {
        return context.prisma.auditLog.findMany({
          where: { listName, itemId },
          orderBy: { timestamp: 'desc' }
        })
      }
    })
  }
}
```

### Using the Audit Plugin

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { auditPlugin } from './plugins/audit-plugin'

export default config({
  plugins: [
    auditPlugin({
      excludeLists: ['AuditLog', 'Session'],
      logReads: false
    })
  ],
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    Post: list({
      fields: {
        title: text(),
        content: text(),
      }
    })
  }
})
```

### Accessing Audit Trail

```typescript
// In server actions or API routes
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: 'user-123' })

// Use plugin runtime service
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
        }
      })
    }
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

Multiple plugins can add hooks to the same list. They execute in plugin order.

```typescript
// Plugin 1: Add timestamp
export function timestampPlugin(): Plugin {
  return {
    name: 'timestamp',
    init: async (context) => {
      for (const listName of Object.keys(context.config.lists)) {
        context.extendList(listName, {
          hooks: {
            resolveInput: async ({ resolvedData }) => {
              resolvedData.updatedAt = new Date()
              return resolvedData
            }
          }
        })
      }
    }
  }
}

// Plugin 2: Add validation
export function validationPlugin(): Plugin {
  return {
    name: 'validation',
    init: async (context) => {
      for (const listName of Object.keys(context.config.lists)) {
        context.extendList(listName, {
          hooks: {
            validateInput: async ({ resolvedData, addValidationError }) => {
              if (resolvedData.spam) {
                addValidationError('Spam detected')
              }
            }
          }
        })
      }
    }
  }
}

// Both hooks execute in order: timestamp → validation
```

### Conditional List Extension

Only extend lists if they exist:

```typescript
init: async (context) => {
  // Only extend User if it exists
  if (context.config.lists.User) {
    context.extendList('User', {
      fields: { apiKey: text() }
    })
  }

  // Only extend lists with specific field
  for (const [listName, listConfig] of Object.entries(context.config.lists)) {
    if (listConfig.fields.authorId) {
      context.extendList(listName, {
        fields: {
          publishedAt: timestamp()
        }
      })
    }
  }
}
```

### Custom Field Types

Register custom field types globally:

```typescript
init: async (context) => {
  // Register custom field type
  context.registerFieldType?.('geolocation', (options) => ({
    type: 'geolocation',
    ...options,
    getZodSchema: (fieldName, operation) => {
      return z.object({
        lat: z.number(),
        lng: z.number()
      })
    },
    getPrismaType: (fieldName) => {
      return { type: 'Json', modifiers: '' }
    },
    getTypeScriptType: () => {
      return { type: '{ lat: number, lng: number }', optional: false }
    }
  }))
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
    }
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
  const {
    apiKey,
    endpoint = 'https://api.example.com',
    retries = 3
  } = options

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

  return { /* ... */ }
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

  return { /* ... */ }
}
```

## Testing Plugins

### Unit Testing

Test plugin initialization and behavior:

```typescript
import { describe, test, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { myPlugin } from './my-plugin'

describe('myPlugin', () => {
  test('adds AuditLog list', () => {
    const cfg = config({
      plugins: [myPlugin()],
      db: { provider: 'sqlite', url: 'file::memory:' },
      lists: {}
    })

    expect(cfg.lists.AuditLog).toBeDefined()
    expect(cfg.lists.AuditLog.fields.action).toBeDefined()
  })

  test('extends User list when present', () => {
    const cfg = config({
      plugins: [myPlugin()],
      db: { provider: 'sqlite', url: 'file::memory:' },
      lists: {
        User: list({ fields: { name: text() } })
      }
    })

    expect(cfg.lists.User.fields.apiKey).toBeDefined()
  })
})
```

### Integration Testing

Test with full stack:

```typescript
test('audit plugin logs operations', async () => {
  // Setup config with plugin
  const cfg = config({
    plugins: [auditPlugin()],
    // ...
  })

  // Generate schema
  await generatePrismaSchema(cfg)
  await prisma.$executeRawUnsafe('...')

  // Create context
  const context = await getContext()

  // Perform operation
  await context.db.post.create({ data: { title: 'Test' } })

  // Check audit log
  const logs = await context.db.auditLog.findMany()
  expect(logs).toHaveLength(1)
  expect(logs[0].operation).toBe('create')
})
```

## Best Practices

### 1. Naming Conventions

- Use descriptive, unique plugin names
- Follow semantic versioning
- Namespace custom field types and tools

### 2. Documentation

Document your plugin thoroughly:

```typescript
/**
 * Audit Plugin for OpenSaaS Stack
 *
 * Automatically logs all database operations to an AuditLog list.
 *
 * @example
 * ```typescript
 * plugins: [
 *   auditPlugin({
 *     excludeLists: ['Session'],
 *     logReads: false
 *   })
 * ]
 * ```
 *
 * @param options - Plugin configuration
 * @param options.excludeLists - Lists to skip audit logging
 * @param options.logReads - Whether to log read operations
 */
export function auditPlugin(options: AuditPluginConfig): Plugin
```

### 3. Error Handling

Provide clear error messages:

```typescript
init: async (context) => {
  if (!context.config.lists.User) {
    throw new Error(
      'myPlugin requires a User list. Please define one or use the auth plugin.'
    )
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

See: `packages/storage/src/config/plugin.ts`

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
- Read about [hooks system](/docs/core-concepts/hooks) for data transformation patterns
- Learn about [MCP setup](/docs/guides/mcp-setup) for AI assistant integration
- Check the [Plugin API reference](/docs/api-reference/config#plugin) for all available methods

## Related Documentation

- [Config System](/docs/core-concepts/config) - Understanding the config architecture
- [Access Control](/docs/core-concepts/access-control) - Securing plugin-added lists
- [Custom Fields](/docs/guides/custom-fields) - Creating custom field types
- [Authentication](/docs/guides/authentication) - Auth plugin usage guide
