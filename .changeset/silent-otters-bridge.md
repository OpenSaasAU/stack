---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-auth': minor
---

Framework components and `createAuth` accept the app's generated context; core is declared side-effect free

The generated `Context` and the engine's `AccessContext` describe one request from two faces, and neither type is assignable to the other. `@opensaas/stack-ui`'s public components (`AdminUI`, `Dashboard`, `Navigation`, `ListView`, `ItemForm`, `SingletonView`, `RelationshipTable`) and `@opensaas/stack-auth`'s `createAuth` / `buildBetterAuthOptions` now take the app-facing context — what `getContext()` and `rawOpensaasContext` produce — so a page passes it straight through:

```tsx
import { getContext, config } from '@/.opensaas/context'

export default async function AdminPage() {
  return <AdminUI context={await getContext()} config={await config} serverAction={serverAction} />
}
```

Core exports the bridge for other framework code: `AnyStackContext` is the type of a context on either face, and `engineContextOf(context)` returns the engine's `AccessContext` for it (`EngineContextUnavailableError` for a hand-assembled object).

**Watch for this when you upgrade.** The seven components above previously read `context.db[listKey]` and `context.session` and worked with any object carrying them. They now narrow through `engineContextOf`, which accepts a context the engine built or a full `AccessContext` and throws otherwise. A hand-assembled stand-in — a component test's double, a Storybook story, a wrapper that rebuilds `{ db, session, … }` by hand instead of passing `getContext()`'s result through — now throws at render. Pass a context from `getContext()`, or from `createTestContext` in `@opensaas/stack-core/testing`.

Two engine fixes the first Next app on Prisma 8 exposed:

- The origin store the tripwire reads, and the key an app-facing context carries its engine face under, are one per process rather than one per module instance. Next.js compiles the page layer and the route-handler layer separately, each with its own copy of the module, while the generated context caches one client for both: a query marked through one layer's Unsafe surface was refused as unmarked by the other layer's tripwire (every `/api/auth/*` route answered 500), and a context built by one layer's `getContext()` could not be narrowed by the other layer's `engineContextOf`. Both now resolve through one helper over the symbol registry `globalThis` shares.
- On the include path the ORM hands an included to-one back under its foreign-key key as well as its own, so a row-dependent field `read` rule comparing `item.authorId` saw the related row rather than its id and denied the author. A field `read` rule is now answered against the row's own stored foreign key whichever way the row was read, so the same rule gives the same answer with and without `.include()` — including where the related list's Access Filter scopes the relation away, which previously made `item.authorId` read as `null` and could open a field whose rule tests for an absent relation. Every terminal (`all()`, `first()`, the `forUpdate()` lane, `nearest()`) returns rows through one funnel that runs both foreign-key passes; a read whose to-one include is narrowed costs one extra query to read the column the include's alias overwrites (#1236).

Core's `package.json` now declares `"sideEffects": false`. The root barrel re-exports modules that import `node:fs` and `node:async_hooks`; a client component importing a value from the barrel — as the admin's own do — would otherwise pull them into the browser bundle and fail to compile under Turbopack. The declaration is truthful: no module in core has an import-time effect a consumer relies on.
