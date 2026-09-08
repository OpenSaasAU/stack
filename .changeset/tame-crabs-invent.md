---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Core's `AugmentedFindUnique`/`AugmentedFindFirst`/`AugmentedFindMany` now carry the same trailing non-generic overload the generator's `CustomDB` already emits (#1287), and `getContext` takes a third, unconstrained, defaulted `TDb` type parameter so a caller can ask for `StackContext<TPrisma, CustomDB>` directly. The generated `.opensaas/context.ts` factory uses this to drop its `as unknown as Context<TSession>` casts down to a single, honest `as Context<TSession>`.
