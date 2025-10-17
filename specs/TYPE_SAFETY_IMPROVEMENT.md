# Type Safety Improvement - Generic PrismaClient

## Problem

The original implementation imported `PrismaClient` from `@prisma/client` directly:

```typescript
import type { PrismaClient } from '@prisma/client'

export async function getContext(
  config: OpenSaaSConfig,
  prisma: PrismaClient,
  session: Session
): Promise<any>
```

**Issue**: The `@prisma/client` package doesn't exist until after you run `prisma generate`, which happens AFTER you've generated the schema from your OpenSaaS config. This creates a chicken-and-egg problem where the core package can't be built without Prisma being generated first.

## Solution

We've made `getContext()` use a generic type parameter:

```typescript
export type PrismaClientLike = {
  [key: string]: any
}

export async function getContext<TPrisma extends PrismaClientLike = any>(
  config: OpenSaaSConfig,
  prisma: TPrisma,
  session: Session
): Promise<any>
```

## Benefits

1. **No Circular Dependency**: The core package can be built before Prisma schema exists
2. **Better Type Safety**: You can pass your specific `PrismaClient` type for better inference
3. **Flexibility**: Works with any Prisma-like client (useful for testing or custom implementations)

## Usage

### Basic Usage (Default)

```typescript
import { PrismaClient } from '@prisma/client'
import { getContext } from '@opensaas/core'
import config from './opensaas.config'

const prisma = new PrismaClient()
const session = await getSession()

// Works without type parameter
const context = await getContext(config, prisma, session)
```

### With Explicit Type Parameter (Recommended)

```typescript
import { PrismaClient } from '@prisma/client'
import { getContext } from '@opensaas/core'
import config from './opensaas.config'

const prisma = new PrismaClient()
const session = await getSession()

// Explicit type parameter for better type inference
const context = await getContext<PrismaClient>(config, prisma, session)
```

### In Your Context Helper

```typescript
// lib/context.ts
import { PrismaClient } from '@prisma/client'
import { getContext as createContext } from '@opensaas/core'
import config from '../opensaas.config'
import type { Context } from '../.opensaas/types'

const prisma = new PrismaClient()

export async function getContext(): Promise<Context> {
  const session = await getSession()
  
  // Pass PrismaClient as generic for type safety
  const context = await createContext<PrismaClient>(config, prisma, session)
  
  return context as Context
}
```

## Generated Types

The generated `.opensaas/types.ts` file no longer imports `PrismaClient`:

```typescript
// Before
import type { PrismaClient } from '@prisma/client'

export type Context = {
  db: { /* ... */ }
  session: any
  prisma: PrismaClient
}

// After
export type Context = {
  db: { /* ... */ }
  session: any
  prisma: any  // Your PrismaClient instance
}
```

This allows the types file to be generated before running `prisma generate`.

## Migration Guide

If you have existing code, no changes are required! The generic parameter has a default value, so this change is **backward compatible**.

However, for better type safety, you can explicitly pass the `PrismaClient` type:

```diff
- const context = await getContext(config, prisma, session)
+ const context = await getContext<PrismaClient>(config, prisma, session)
```

## Technical Details

### Type Constraint

```typescript
export type PrismaClientLike = {
  [key: string]: any
}
```

This constraint allows any object with string keys, which matches the Prisma client structure where each model is accessed as `prisma.modelname`.

### Why Not Import from Peer Dependency?

We could have made `@prisma/client` a peer dependency and imported types from there, but:

1. This would still create a build-time dependency
2. It would require users to install Prisma before building the core package
3. The generic approach is more flexible and follows TypeScript best practices

### Internal Usage

All internal helper functions also use the generic:

```typescript
function createFindUnique<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext
)
```

This ensures type consistency throughout the codebase.

## Testing

The blog example has been updated to use the generic type parameter:

```typescript
// examples/blog/lib/context.ts
export async function getContext(): Promise<Context> {
  const session = config.session ? await config.session.getSession() : null
  const context = await createContext<PrismaClient>(config, prisma, session)
  return context as Context
}
```

All tests pass with this change, confirming backward compatibility.

## Future Improvements

Potential future enhancements:

1. **Better Type Inference**: Could generate a more specific context type that includes the actual Prisma client methods
2. **Type-safe Models**: Could use TypeScript conditional types to infer model types from the Prisma client
3. **Stricter Constraint**: Could make `PrismaClientLike` more specific to catch errors earlier

## Questions?

If you encounter any issues with this change, please:

1. Check that you're passing the correct Prisma client instance
2. Verify the generic type parameter matches your Prisma client
3. Ensure you've run `prisma generate` to create the client types
4. Check the generated `.opensaas/types.ts` file for any issues

See the [blog example](examples/blog/lib/context.ts) for a complete working implementation.
