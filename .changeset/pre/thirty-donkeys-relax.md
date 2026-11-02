---
'@opensaas/stack-ui': minor
'@opensaas/stack-core': patch
---

Render `decimal()` fields in the admin UI

`decimal()` had no registered UI component, so a field declared with it logged
`No component registered for field type: decimal` and could not be edited at
all. It now has a form component and reuses the existing integer list-table
cell, registered under `decimal` in the usual registries — no wiring needed:

```typescript
// opensaas.config.ts
fields: {
  price: decimal({ precision: 10, scale: 2 }),
}
```

Prisma 8's numeric codec is a branded `string`, never a `decimal.js`
`Decimal` — confirmed empirically by writing a value with more significant
digits than a JS `number` can hold and reading it back. So the value read
from and written to `context.db` is a plain numeric-text string
(`'19.99'`) on both sides, full precision intact through the server/client
boundary with no special encoding needed. `@opensaas/stack-core`'s
`decimal()` doc comments, which described the pre-Prisma-8 `Decimal`
assumption, are corrected to match.

`DecimalField` is exported for custom UIs:

```typescript
import { DecimalField } from '@opensaas/stack-ui/fields'
```
