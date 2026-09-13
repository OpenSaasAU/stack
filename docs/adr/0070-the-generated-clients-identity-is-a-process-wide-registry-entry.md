# The generated client's identity is a process-wide registry entry, written in every environment

Status: accepted

Spec 2 (ADR-0059) gave the generated context a client singleton: a module-local `clientPromise` memo, backed by `globalForClient.opensaasClient` — a plain property on `globalThis`, written only when `NODE_ENV !== 'production'`. The review of [#1199](https://github.com/OpenSaasAU/stack/pull/1199) (finding 4, deliberately not patched there) and [#1201](https://github.com/OpenSaasAU/stack/issues/1201) named the consequence: a bundler that compiles `.opensaas/context.ts` into more than one bundle gives each copy its own module scope, so `clientPromise` cannot be shared between them, and in production — where a duplicated pool costs the most — the global was not written either, so nothing spanned the copies at all. "Once per process" was really "once per module instance," and the guarantee was weakest exactly where a second pool against the Dev database's socket-multiplexed session, or against a deployment's own connection ceiling, is most expensive.

The dev-only write was also load-bearing in a way nothing declared: fixing #1142's concurrency probe, the implementer found the pre-fix, non-memoised `getClient` still logged one construction under the default test environment, because the global caught the second and third racing callers on their way out of the `await` — the probe only became honest once it ran under `NODE_ENV=production`. A guarantee resting on an environment check nobody meant to test is not a guarantee.

## Decision

**The client's identity moves onto `processGlobal`** (`packages/core/src/lib/process-global.ts`), the same `Symbol.for` / `globalThis` registry already used for the Engine stamp's `AsyncLocalStorage` store (`origin.ts`) and the engine-context face (`ENGINE_FACE`, `context/engine-context.ts`). The generated context's `getClient()` becomes:

```typescript
function isRuntimeClient(value: unknown): value is ReturnType<typeof createClient> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'orm' in value &&
    'sql' in value &&
    'raw' in value &&
    'transaction' in value
  )
}

function getClient() {
  if (clientPromise) return clientPromise
  const attempt = (async () => {
    const config = await getConfig()
    return processGlobal('client', isRuntimeClient, () => createClient(config))
  })().catch((error) => {
    if (clientPromise === attempt) clientPromise = null
    throw error
  })
  clientPromise = attempt
  return attempt
}
```

`processGlobal` is exported from `@opensaas/stack-core/internal`, alongside the other generated-bundle plumbing already reached from there (`HashedPassword`, `findDatabaseConnection`).

- **Written in every environment, unconditionally.** The `NODE_ENV !== 'production'` guard is deleted outright rather than inverted or widened — there is exactly one process to agree across, and production is where getting this wrong costs the most, so it is the last place the guarantee should be weaker than elsewhere.
- **A structural `is` check, not a version-namespaced key.** `processGlobal`'s existing contract (its `originStore` and `ENGINE_FACE` callers alike) is: namespace the registry key by what the value IS, and verify a value already published under that name before adopting it, rather than trusting a bare `globalThis` slot. `isRuntimeClient` mirrors `unsafe.ts`'s own `UnsafeCapableClient` shape (`orm`, `sql`, `raw`, `transaction`) rather than checking against a version string, which is consistent with how `originStore` already resolves the equivalent risk — `value instanceof AsyncLocalStorage` — without embedding a version anywhere. A value that fails the check is treated as absent and replaced, the same way a foreign value at that key already is for the other two registries.
- **The module-local `clientPromise` memo is unchanged and still does real work**: it is what serialises two callers racing the same module instance's own `await getConfig()`, which `processGlobal`'s synchronous read-then-write cannot do on its own (the config resolution is the async gap; the registry access straddling it is not). The registry is what makes two DIFFERENT module instances agree once each has cleared that gap.
- **The Dev database's `maxConnections` headroom is reconciled, not changed.** Its comment already meant distinct PROCESSES sharing one sidecar (the app, the CLI, a seed, `psql`) — the fix here makes that reading hold for a single app process that a bundler happens to duplicate, which previously could have silently spent more than one of those slots on itself. `DEFAULT_MAX_CONNECTIONS` (20) needed no change; the risk it was accidentally covering for is closed instead.

## Considered options

- **Widen the existing `globalForClient` write to every environment, keyed by a plain string.** This is the same idea with less of `processGlobal`'s existing machinery reused: a second stack version in the same process (an unusual but not impossible pnpm-hoisting outcome) publishing a differently-shaped value at the same bare key would be adopted blindly, where `processGlobal`'s `is` check already exists to catch exactly that. Rejected in favor of the module the codebase already established for this problem rather than a second, parallel mechanism.
- **A runtime-owned registry** (a class or module the CLI generates alongside `context.ts` that both copies import and call into). Rejected: it is strictly more machinery than `processGlobal` for the same guarantee, and introduces a second registry pattern beside the one `origin.ts` already uses for the same class of problem — the "one deletable component" property ADR-0059 valued for the origin store applies here too.
- **Document identity as per-module-instance and size the Dev database's ceiling for it.** Rejected as the issue itself frames it: production is where a duplicated pool is most expensive, so accepting the duplication instead of closing it puts the cost in the wrong place. It would also mean `context.transaction` and the connection-pool sizing CLAUDE.md already documents as assuming one client would need re-auditing for N, for no benefit over just having one.
- **A version string baked into the registry key** (`Symbol.for('@opensaas/stack-core/client@0.43.0')`), so two stack versions in one process never share a slot at all. Rejected as unnecessary given the `is` check: two versions publishing structurally-compatible clients can safely share one pool, and two publishing incompatible ones are already caught by the guard — a version-keyed slot would instead give incompatible versions in one process two separate pools against the same database, which is the exact failure mode this record closes.

## Consequences

- `@opensaas/stack-core/internal` gains `processGlobal`. It carries no new semver guarantee beyond what the subpath already states — generated code and sibling packages only.
- The generated `.opensaas/context.ts` template drops `globalForClient` and its `NODE_ENV` branch entirely; `packages/cli/src/generator/context.test.ts` asserts neither string appears.
- `packages/cli/tests/bundle-client-construction.test.ts` gains a probe that imports two on-disk copies of `context.ts` under `NODE_ENV=production` and asserts the pg-pool factory is called once, not twice — the shape that fails against the retired per-module-instance behavior and passed against the version this record replaces before this test existed.
- `packages/core/src/db/dev-database.ts`'s `maxConnections` doc gains one sentence naming this record; the constant itself is untouched.
