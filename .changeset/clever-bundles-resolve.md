---
'@opensaas/stack-cli': minor
---

Emit explicit `.ts` import extensions in the generated `.opensaas` bundle so it's loadable by the host bundler

The generator now appends an explicit `.ts` extension to every relative import it emits across the Generated bundle — `context.ts`, `types.ts`, `prisma-extensions.ts`, `lists.ts`, the `opensaas.config` import, and the `prisma-client/**` tree references. Previously these specifiers were extensionless (e.g. `import { PrismaClient } from './prisma-client/client'`), which only a TS-aware loader could resolve. A plain Node process or an un-aliased bundler (webpack/Next) failed to resolve the sub-imports, and pushing the bundle out of the compile graph with a `webpackIgnore`d dynamic `import()` meant `next build` never file-traced the `prisma-client/**` subtree into the serverless output.

With explicit extensions the bundle resolves identically under `tsx`, `vitest`, plain Node type-stripping, esbuild, and webpack/Next without any consumer-side `extensionAlias`, and statically importing it compiles + file-traces under `next build`. This is the default output (no flag). See ADR-0008.

Generated output (before → after):

```typescript
// before
import { PrismaClient } from './prisma-client/client'
import type { Context } from './types'
import { prismaExtensions } from './prisma-extensions'
import configOrPromise from '../opensaas.config'

// after
import { PrismaClient } from './prisma-client/client.ts'
import type { Context } from './types.ts'
import { prismaExtensions } from './prisma-extensions.ts'
import configOrPromise from '../opensaas.config.ts'
```

Regenerate with `pnpm generate` to pick up the new extensions. The supported production path is to statically import the bundle (e.g. `import { getContext } from '@/.opensaas/context'`) so the host build traces it — see the deployment guide for the `outputFileTracingIncludes` recipe.
