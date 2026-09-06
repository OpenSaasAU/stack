---
'@opensaas/stack-auth': minor
---

The Auth adapter implements better-auth's factory transaction option, so sign-up is atomic

`opensaasAuthAdapter` resolves its lane per operation. The factory's
`transaction` option runs a second, transaction-bound instance against the
transaction's own Unsafe surface, so sign-up's user, account and session writes
commit or roll back as one — a failing account write now leaves no user row.
That instance ships the option off and brackets `consumeOne` on the lane it
already holds.

One known limit comes with it, stated on `opensaasAuthAdapter`: better-auth
swaps the transaction-bound adapter in only through its AsyncLocalStorage
store, so a `databaseHooks` `before` hook that queries `context.adapter`
directly runs outside the transaction
([#1252](https://github.com/OpenSaasAU/stack/issues/1252)).

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
