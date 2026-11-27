---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-rag': patch
'@opensaas/stack-tiptap': patch
'create-opensaas-app': patch
---

Add client-safe entry points so `next build --webpack` builds the admin

A `'use client'` module that imported from `@opensaas/stack-core` or `@opensaas/stack-ui` pulled the
server graph into the browser bundle, and webpack refused it (`UnhandledSchemeError: node:async_hooks`).
Turbopack tolerated the same graph, so only `next build --webpack` failed. The admin's own client
components now import from two new entries that reach nothing server-side:

- `@opensaas/stack-core/client-safe` — `getUrlKey`, `getListKeyFromUrl`, `resolveListKeyFromUrl` and the
  filter-query helpers (`parseFilterQuery`, `serializeFilterQuery`, `recordIdFilterToken`, …). The root
  entry still exports the same bindings.
- `@opensaas/stack-ui/cells` — the cell components and `registerCellComponent`.

A field-registration module in your app should import from these, never from a package root:

```ts
// lib/register-fields.ts
'use client'

// Before: pulled AdminUI and the server graph into the client bundle
// import { registerFieldComponent } from '@opensaas/stack-ui'
import { registerFieldComponent } from '@opensaas/stack-ui/fields'
import { registerCellComponent } from '@opensaas/stack-ui/cells'
import { getUrlKey } from '@opensaas/stack-core/client-safe'
```

The rag and tiptap registration modules now do the same.
