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
import { createContext } from '@opensaas/stack-core/context'
```

## Learn More

- **[Quick Start](/docs/quick-start)** - Get started in 5 minutes
- **[Config System](/docs/core-concepts/config)** - Config options
- **[Field Types](/docs/core-concepts/field-types)** - Available fields
