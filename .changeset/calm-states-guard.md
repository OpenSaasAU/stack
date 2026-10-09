---
'@opensaas/stack-core': minor
---

`transitionGuard()` enforces a state machine on a `select` field

Returns a list-level `validate` hook, so it runs for every caller (`sudo()` included) and checks values set by `resolveInput`. An optional stored `discriminator` field keys the allow-list.

```typescript
import { transitionGuard } from '@opensaas/stack-core'

hooks: {
  validate: transitionGuard({
    field: 'state',
    discriminator: 'action',
    initial: { EDIT: ['PREPARED'] },
    allowed: { EDIT: { PREPARED: ['DISPATCHING'] } },
  }),
}
```
