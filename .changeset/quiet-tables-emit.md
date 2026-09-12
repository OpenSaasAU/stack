---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Generation emits the dependency-set table and the unique-constraint map; the runtime dependency fold is deleted

`pnpm generate` now resolves each computed field's `needs` into its one-hop set — columns and relations, a relation implying its foreign-key column — records each list's actual system fields, and writes both plus a unique-constraint-name-to-field-names map to `.opensaas/tables.ts`. The generated context hands them to the runtime, so the engine widens a read from an emitted fact instead of walking the config on every read (ADR-0051), and a unique violation can resolve to per-field messages without parsing error prose (ADR-0042).

```ts
// .opensaas/tables.ts
export const dependencyTable: DependencyTable = {
  Post: {
    systemFields: ['id', 'createdAt', 'updatedAt'],
    fields: {
      byline: { columns: ['authorId', 'title'], relations: ['author'] },
    },
  },
  Category: { systemFields: ['id'], fields: {} }, // db.timestamps: false
}

export const constraintMap: ConstraintMap = {
  User_email_key: { list: 'User', fields: ['email'] },
  Profile_user_key: { list: 'Profile', fields: ['user'] },
}
```

Core exports `deriveDependencyTable(config)`, `deriveConstraintMap(config, contract)` and `deriveGeneratedTables(config, contract)` for anything that needs the same facts.

The dependency set is one hop and non-transitive, so a declaration can no longer form a closure: `validateNeedsClosureDepth` and its `'cycle'`/`'depth'` refusals, the recursive `foldDeclaredDependencies`, its `visitedLists` cycle guard and `DeclaredOnlyTree` are all removed. A config that used to fail generation with an over-deep or cyclic `needs` closure now generates. `validateNeedsDeclarations` is unchanged and still refuses an entry naming nothing on the list, an entry naming a computed field, and a `needs` on a field with no `resolveOutput` hook.

One behaviour change to be aware of: a relation fetched only to satisfy a declaration no longer has its own computed fields run, so it no longer carries its own declarations either. A hook needing two hops takes a privileged read inside itself.

**Migration note (silent break):** a `resolveOutput` hook on a list reached only as another field's declared dependency stops running. Its value was already stripped from the caller's result along with the branch, so nothing a caller receives changes — but a hook with a side effect (a counter, a log, a cache write) loses it. Grep for `resolveOutput` hooks on lists that appear in another list's `needs` and do more than return a value.

The derived constraint names now match what PostgreSQL actually stores for an identifier over 63 bytes. A primary key is emitted unnamed and PostgreSQL derives it with `makeObjectName`, which reserves the `_pkey` label and shrinks the table component (`<58 chars>_pkey`); a unique is named by Prisma and only clipped by PostgreSQL, which keeps the leading 63 bytes and loses `_key`. Previously both were clipped, so every derived primary-key name over the limit was wrong and a `23505` on it would have missed the map.
