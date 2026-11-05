---
'@opensaas/stack-ui': minor
---

`serializeFieldConfigs` is exported from `@opensaas/stack-ui/server`

A page that hands `config.lists.Post.fields` straight to a `'use client'`
component fails at render: a field config carries its own methods
(`getZodSchema`, `getContractField`, `getFilterSpec`, …) and its `hooks` and
`access` rules are functions, and React refuses to serialise a function across
the boundary. `ItemCreateForm` and `ItemEditForm` already sanitise internally,
but by then the props have crossed the boundary at the caller's own client
component — so the caller needs the sanitiser too, and until now had to
hand-roll one.

```typescript
// app/posts/page.tsx — a Server Component
import { serializeFieldConfigs } from '@opensaas/stack-ui/server'

<CreatePostDialog fields={serializeFieldConfigs((await config).lists.Post.fields)} />
```

```typescript
// components/CreatePostDialog.tsx
'use client'
import type { SerializableFieldConfig } from '@opensaas/stack-ui/server'

export function CreatePostDialog({ fields }: { fields: Record<string, SerializableFieldConfig> }) {
```

`serializeFieldConfig` and the `SerializableFieldConfig` type are exported
alongside it. This is the same allowlist the admin UI uses, so it stays complete
as `FieldConfig` grows.
