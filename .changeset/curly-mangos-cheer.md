---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-storage': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-tiptap': minor
---

Curate the `@opensaas/stack-core` public surface into clearly-scoped entry points

The root entry point now exposes only the everyday consumer surface — `config`,
`list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`,
`getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate
with. Plugin and field authoring contracts move to a new `/extend` path, and the
plumbing shared with sibling packages and generated code moves to `/internal`.

```typescript
// Everyday usage (unchanged)
import { config, list, getContext } from '@opensaas/stack-core'

// Authoring a plugin or a third-party field package
import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
```

`@opensaas/stack-core/internal` carries no semver guarantees; application code
should never import from it. `Session` stays on the root entry point because it is
the module-augmentation target.

Removed from the public surface (zero callers): the nine `*HookArgs` types and the
callerless typed-query runtime types. The other `@opensaas/*` packages and the CLI
generator are updated to import from the new paths.
