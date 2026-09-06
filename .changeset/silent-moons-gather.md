---
'@opensaas/stack-auth': minor
---

The Auth adapter implements better-auth's factory transaction option, so sign-up is atomic

`opensaasAuthAdapter` builds its factory per lane. The factory's `transaction`
option rebinds a second instance to the transaction-bound Unsafe surface, so
sign-up's user, account and session writes commit or roll back as one — a
failing account write now leaves no user row. A transaction-bound instance
ships the option off and brackets `consumeOne` on the lane it already holds.

No isolation level is selectable and auth transactions run at Read Committed
(ADR-0042), which is unchanged.

Nothing in an application changes:

```typescript
// lib/auth.ts — unchanged
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)
```

better-auth's own `transactions` and `authFlow` conformance suites now run over
the Test context alongside `normal`, `uuid` and `caseInsensitive`.
