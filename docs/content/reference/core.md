# Core Package

The `@opensaas/stack-core` package is the foundation of OpenSaaS Stack, providing the config system, access control engine, and code generators.

## Installation

```bash
pnpm add @opensaas/stack-core
```

## Key Features

- Config-first schema definition
- Automatic access control engine
- Code generation (Prisma + TypeScript)
- Field types and validation
- Hooks system
- Sudo mode for bypassing access control
- MCP (Model Context Protocol) handlers
- Plugin system integration

## Exports

### Config & context (root)

The everyday surface lives on the root entry point — config builders, the context
factory, naming helpers, and the config/access types you annotate with:

```typescript
import { config, list, getContext, getUrlKey } from '@opensaas/stack-core'
import type { OpenSaasConfig, AccessControl, Session } from '@opensaas/stack-core'
```

### Fields

```typescript
import {
  text,
  integer,
  checkbox,
  timestamp,
  password,
  select,
  relationship,
} from '@opensaas/stack-core/fields'
```

### Extend (plugin & field authoring)

Implement these contracts to build a plugin or a third-party field package:

```typescript
import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
```

### MCP (Model Context Protocol)

```typescript
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
```

### Internal

`@opensaas/stack-core/internal` holds plumbing shared between the `@opensaas/*`
packages and generated `.opensaas/` code. It carries **no semver guarantees** —
application code should never import from it.

## Sudo Mode

Sudo mode creates a context that bypasses access control while still executing hooks and validation. Useful for admin operations, background jobs, and migrations.

```typescript
const context = await getContext(session)
const sudoContext = context.sudo()

// Access all records regardless of access rules
const allPosts = await sudoContext.db.post.findMany()
```

**Warning:** Only use sudo mode in trusted server-side code. Always verify authorization before using sudo.

## Plugin System

The core package supports plugins for extending functionality. Plugins can inject lists, add hooks, register MCP tools, and participate in code generation.

```typescript
import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
  // ...
})
```

See the [Plugins Guide](/docs/how-to/write-a-plugin) for creating custom plugins.

## Learn More

- **[Quick Start](/docs/tutorials/quick-start)** - Get started in 5 minutes
- **[Config System](/docs/concepts/config)** - Config options
- **[Field Types](/docs/concepts/field-types)** - Available fields
