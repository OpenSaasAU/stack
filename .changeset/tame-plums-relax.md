---
'@opensaas/stack-cli': minor
---

Resolve `tsconfig.json` path aliases (`compilerOptions.paths`) when loading `opensaas.config.ts`, so a value import using an alias (e.g. `@/*`) works in the config and anywhere in its import closure, not just in type-only positions.

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}

// opensaas.config.ts
import { lists } from '@/opensaas/lists' // now resolves
```

Only the single-trailing-`*`, single-target form of `paths` is translated; an entry with multiple candidate targets or an unsupported pattern shape logs a warning naming the pattern and is skipped rather than failing generation. Projects without a `tsconfig.json`, or without `paths`, are unaffected. The `opensaas migrate` command's Keystone config loader resolves aliases the same way.
