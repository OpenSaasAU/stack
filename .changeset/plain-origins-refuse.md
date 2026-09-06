---
'@opensaas/stack-core': minor
---

Add the origin module — the ambient Engine stamp, its tripwire and its refusal error

`@opensaas/stack-core/origin` is the one component a declared surface installs to mark the
queries it executes, and the one the ORM refuses unmarked queries with (ADR-0059). The
generated context and the test harness install the same value.

```ts
import { originTripwire, withOrigin, preserveOrigin } from '@opensaas/stack-core/origin'

// Installed once, where the client is constructed.
const client = postgres({ contractJson, middleware: [originTripwire] })

// A surface that materialises enters the origin around exactly its ORM call,
// with the await inside — hooks therefore run outside the mark.
const rows = await withOrigin('engine', () => orm.Post.where({ id }).all())

// A surface that hands a lazy result back wraps it, so `then`, `toArray`,
// `first`, `firstOrThrow` and the async iterator's `next` each re-enter the
// scope and the query executes marked wherever the caller consumes it.
return preserveOrigin('unsafe', client.runtime().query(plan))
```

Any plan compiled with no origin in scope throws `UnmarkedQueryError` from `beforeCompile`,
in every environment — there is no warn mode and no dev-only mode. The store carries
`'engine' | 'unsafe'` and nothing else: no session, no policy. Scoping a query to a session
stays an ordinary rebind of the secured context.
