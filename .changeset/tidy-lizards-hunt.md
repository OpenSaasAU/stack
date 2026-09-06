---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Thread the app's Prisma client type through `TypeInfo` into every list/field hook-args type, so a hook's `context` resolves to the consumer's own `StackContext` instead of `StackContext<any>`.

Before this change, `TypeInfo` carried no client type, so `context.db` inside any hook resolved through `AccessControlledDB<any>` — a mapped type over `keyof any` that declares no named delegate. A hook's `context` was therefore assignable to nothing app-specific, forcing consumers who wanted to pass it into their own typed functions to write `context as unknown as Context`.

`TypeInfo` now has a `prisma` member (defaulted to the existing `PrismaClientLike`, so this is fully additive), and every hook-args type — `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`, `AfterOperationHookArgs`, `BeforeTransactionHookArgs`/`AfterTransactionHookArgs`, and their field-level equivalents — types `context` off it:

```typescript
// A hook authored the documented way now gets a context keyed to your own
// generated Prisma client, with no cast needed to use it elsewhere:
Post: list<Lists.Post.TypeInfo>({
  hooks: {
    validate: async ({ context }) => {
      await myDomainFn({ context }) // ✅ context.db.post etc. are real, typed delegates
    },
  },
})
```

The CLI generator emits the new `prisma` member on each list's `Lists.<List>.TypeInfo`, pointing at your project's own generated `PrismaClient` — no config changes required, and a hook authored without `TypeInfo` is unaffected.

Because `context.db.<list>` now resolves to a real delegate instead of `any`, a pre-existing type error in a hook that previously compiled silently (e.g. a return value that didn't actually match the list's row type) can now surface as a genuine compile error. `AccessControlledDB`'s catch-all index signature is unchanged by this fix, so a misspelled delegate name (`context.db.typoedListName`) is not yet caught — that's a separate, tracked limitation.
