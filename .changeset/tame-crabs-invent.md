---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Core's `AugmentedFindUnique`/`AugmentedFindFirst`/`AugmentedFindMany` now carry the same trailing non-generic overload the generator's `CustomDB` already emits (#1287), and `getContext` takes a third, unconstrained, defaulted `TDb` type parameter so a caller can ask for `StackContext<TPrisma, CustomDB>` directly. The generated `.opensaas/context.ts` factory uses this to drop its `as unknown as Context<TSession>` casts down to a single, honest `as Context<TSession>`.

Observable side effect: since `Parameters<>`/`ReturnType<>` resolve against an overloaded type's LAST member, `Parameters<AccessControlledDB<P>[K]['findMany' | 'findFirst' | 'findUnique']>[0]` now resolves to the new trailing member's argument type (Prisma's args shape minus `select`/`include`/`query`) instead of the full original Prisma args — anyone introspecting these types directly via `Parameters<>` will see this narrower shape.
