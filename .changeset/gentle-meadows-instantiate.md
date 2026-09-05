---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

The generated types file declares the contract remainder and instantiates core's generics

`.opensaas/types.ts` no longer re-derives every scalar type, nullability and
relation arity by hand. It writes one `Remainder` entry per list — the four
facts the emitted Contract artifacts cannot carry — and names one interface per
shape extending a generic `@opensaas/stack-core` now exports, keyed by the
emitted `Contract`:

```typescript
export type Remainder = {
  User: {
    computed: { displayName: string }
    output: { secret: import('@opensaas/stack-core/internal').HashedPassword }
    input: Record<never, never>
    needs: { displayName: 'name' }
  }
  Settings: {
    computed: Record<never, never>
    output: Record<never, never>
    input: Record<never, never>
    needs: Record<never, never>
    singleton: true
  }
}

export interface User extends Row<Contract, Remainder, 'User'> {}
export interface UserCreateInput extends CreateInput<Contract, Remainder, 'User'> {}
export interface UserUpdateInput extends UpdateInput<Contract, Remainder, 'User'> {}
export interface UserList extends SecuredList<Contract, Remainder, 'User'> {}

export interface Context<TSession extends Session = Session> extends StackContext<
  DB,
  TSession,
  PluginServices
> {}
```

`Post`, `PostCreateInput`, `PostUpdateInput`, `Context`, `BaseContext`,
`TransactionContext` and `Lists.Post.TypeInfo` keep their names, so imports do
not change. What changes is what they mean:

- **An included to-one relation reads `| null`, a to-many `[]`** — by arity
  alone, whatever the foreign key's nullability. Access control can scope the
  related row away, so code that dereferenced a required relation without a
  check now fails `tsc`.
- **A `resolveOutput` hook's `item` is exactly its declared `needs` plus the
  list's system fields.** Reading an undeclared column is a compile error for
  any hook authored under `list<Lists.Post.TypeInfo>`:

  ```typescript
  excerpt: virtual({
    type: 'string',
    needs: ['content'],
    hooks: {
      resolveOutput: ({ item }) => item.content.slice(0, 100), // compiles
      // resolveOutput: ({ item }) => item.title,              // tsc error
    },
  })
  ```

- **A write input is checked against the contract's columns.** A system-filled
  column (`id`, `createdAt`, `updatedAt`) is not writable, a non-nullable column
  with no default is required on create, and an unknown key is rejected.
- Every per-list `GetPayload`, `Select`, `Include`, `WhereInput`, `*Args`,
  `VirtualFields`, `TransformedFields` and `{List}Crud` type is gone;
  `CustomDB` is now `DB`.

`PrismaClientLike = any` is deleted. `context.prisma` is `OrmClient`, a
structural interface, and `AccessContext`, `StackContext` and
`AccessControlledDB` lose their `TPrisma` type parameter — drop the argument:

```typescript
// Before
function render(context: AccessContext<unknown>) {}
// After
function render(context: AccessContext) {}
```

The bundle's type-only import of the emitted declarations is now
`'../prisma/contract.d.js'`. `'../prisma/contract.d.ts'` resolved to the
Contract module sitting beside it, so `Contract` was not among the exports the
import found; re-run `pnpm generate`.
