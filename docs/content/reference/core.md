# Core Package

The `@opensaas/stack-core` package is the foundation of Stack, providing the config system, access control engine, and code generators.

## Installation

```bash
pnpm add @opensaas/stack-core
```

## Key Features

- Config-first schema definition
- Automatic access control engine
- Code generation (the contract, the Prisma config, and the `.opensaas/` bundle)
- Field types and validation
- Hooks system
- Sudo mode for bypassing access control
- MCP (Model Context Protocol) handlers
- Plugin system integration

## Entry points

| Specifier                              | Holds                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `@opensaas/stack-core`                  | The everyday surface — config builders, context factory, errors, types     |
| `@opensaas/stack-core/fields`           | Field builders and their config types                                     |
| `@opensaas/stack-core/extend`           | Plugin and third-party field authoring contracts                          |
| `@opensaas/stack-core/mcp`              | MCP request handlers                                                      |
| `@opensaas/stack-core/unsafe`           | The `context.unsafe` surface types and its refusals                       |
| `@opensaas/stack-core/client`           | `resolveRuntimeConnection`, used by the generated context                 |
| `@opensaas/stack-core/dev-database`     | The PGlite-backed Dev database the `dev` loop can resolve to              |
| `@opensaas/stack-core/contract`         | Contract derivation fed into the Prisma builder                           |
| `@opensaas/stack-core/origin`           | `originTripwire`, the middleware the generated context installs           |
| `@opensaas/stack-core/config/plugin-engine` | Plugin dependency resolution and execution                            |
| `@opensaas/stack-core/testing`          | Test helpers for exercising a config without a database                   |
| `@opensaas/stack-core/internal`         | Plumbing shared with the other `@opensaas/*` packages — **no semver guarantees**, never import from application code |

There is no `@opensaas/stack-core/context`. `getContext` is on the root, but an
application normally imports the *generated* factory from `@/.opensaas/context`
instead — that one carries the config and the client for you.

## Root exports

### Config & context

```typescript
import { config, list, getContext, getUrlKey, getListKeyFromUrl } from '@opensaas/stack-core'
import type { OpenSaasConfig, ListConfig, DatabaseConfig, Session } from '@opensaas/stack-core'
```

### Access control

`checkAccess`, `checkCreateAccess` and `mergeFilters` are the supported way for
code reading *outside* `context.db` — a plugin composing its own query, say — to
evaluate a list's operation-level rule and fold the result into its own `where`.
They scope rows only: field-level `read` access and `resolveOutput` run inside
`context.db`, so a caller here owns field visibility itself.

```typescript
import { checkAccess, checkCreateAccess, mergeFilters } from '@opensaas/stack-core'
import type { AccessControl, FieldAccess, AccessContext, PrismaFilter } from '@opensaas/stack-core'
```

### Errors

Every engine terminal raises a stack-owned error rather than the driver's own.
There are no `P####` codes to match on, and `DatabaseError` carries no `code`
property — branch on the class or the predicate instead.

```typescript
import {
  DatabaseError,
  SerializationFailure,
  UniqueConstraintViolation,
  isSerializationFailure,
  isUniqueConstraintViolation,
  ValidationError,
} from '@opensaas/stack-core'
```

- `DatabaseError` — the base class; carries `fieldErrors`.
- `SerializationFailure` — SQLSTATE 40001. Retrying is the caller's own loop; the stack ships no retry helper.
- `UniqueConstraintViolation` — carries `constraintName`, `list` and `fields`, resolved to OpenSaaS field names through the generated constraint map. A hand-made constraint that isn't in the map keeps a generic message and `fields: []`.

Access *denial* raises nothing at all — it is silent, returning `[]`, `null` or a
zeroed aggregate. There is no `AccessDeniedError`.

### Database URL lookup

`resolveDatabaseUrl()` is the single place a connection string is chosen:
`DIRECT_DATABASE_URL`, then `DATABASE_URL`, then the Dev database's state file,
otherwise `DatabaseUrlUnresolvedError`. `findDatabaseUrl()` is the non-throwing
variant the generated `prisma.config.ts` calls.

```typescript
import { resolveDatabaseUrl, findDatabaseUrl, DatabaseUrlUnresolvedError } from '@opensaas/stack-core'
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

## Sudo Mode

Sudo mode creates a context that bypasses access control while still executing
hooks and validation. Useful for admin operations, background jobs, and
migrations. It still validates the Where vocabulary — `sudo()` skips access, not
input checking.

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext(session)
const allPosts = await context.sudo().db.Post.all()
```

**Warning:** Only use sudo mode in trusted server-side code. Always verify authorization before using sudo.

The heavier bypass is `context.unsafe`, which drops access control, field
visibility, `resolveOutput`, computed fields, hooks **and** error normalisation.
See the [Context API](/docs/reference/context-api) for both.

## Plugin System

The core package supports plugins for extending functionality. Plugins can inject lists, add hooks, register MCP tools, and participate in code generation.

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
  db: { provider: 'postgresql' },
  lists: {
    Post: list({ fields: { title: text() } }),
  },
})
```

`postgresql` is the only provider, and the connection string is not a config key
— it is resolved by `resolveDatabaseUrl()` from the environment. See the
[Config API](/docs/reference/config-api#db) for the complete `db` key list.

See the [Plugins Guide](/docs/how-to/write-a-plugin) for creating custom plugins.

## Learn More

- **[Quick Start](/docs/tutorials/quick-start)** - Get started in 5 minutes
- **[Config System](/docs/concepts/config)** - Config options
- **[Field Types](/docs/concepts/field-types)** - Available fields
