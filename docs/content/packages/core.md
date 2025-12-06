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

### Config

```typescript
import { config, list } from '@opensaas/stack-core/config'
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

### Context

```typescript
import { getContext } from '@opensaas/stack-core/context'
```

### MCP (Model Context Protocol)

```typescript
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
```

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

See the [Plugins Guide](/docs/guides/plugins) for creating custom plugins.

## Learn More

- **[Quick Start](/docs/quick-start)** - Get started in 5 minutes
- **[Config System](/docs/core-concepts/config)** - Config options
- **[Field Types](/docs/core-concepts/field-types)** - Available fields
