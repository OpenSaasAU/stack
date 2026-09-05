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

export interface User extends Stack$Row<Stack$Contract, Remainder, 'User'> {}
export interface UserCreateInput extends Stack$CreateInput<Stack$Contract, Remainder, 'User'> {}
export interface UserUpdateInput extends Stack$UpdateInput<Stack$Contract, Remainder, 'User'> {}
export interface UserList extends Stack$SecuredList<Stack$Contract, Remainder, 'User'> {}

export interface Context<TSession extends Stack$Session = Stack$Session> extends Stack$StackContext<
  DB,
  TSession,
  Stack$PluginServices
> {}
```

Everything the file imports is aliased behind `Stack$`, so a list may be named
`Row`, `Contract` or `Session` without shadowing the generic its own interface
is declared from. Only what is used is imported, so a bundle compiled under
`noUnusedLocals` stays clean.

`Post`, `PostCreateInput`, `PostUpdateInput`, `Context`, `BaseContext`,
`TransactionContext` and `Lists.Post.TypeInfo` keep their names, so imports do
not change. What changes is what they mean:

- **An included to-one relation reads `| null`, a to-many `[]`** — by arity
  alone, whatever the foreign key's nullability. Access control can scope the
  related row away, so code that dereferenced a required relation without a
  check now fails `tsc`.
- **A virtual field's `resolveOutput` hook receives exactly its declared
  `needs` plus the list's system fields.** Reading an undeclared column is a
  compile error for any hook authored under `list<Lists.Post.TypeInfo>`:

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

  The set is the one `deriveDependencyTable` resolves for the runtime
  (ADR-0051), not the declaration as written, so **a `needs` naming a
  relationship yields a different `item` type than before**: it now carries the
  foreign-key column this side owns as well as the relation, matching what the
  widening actually fetches.

  ```typescript
  byline: virtual({
    type: 'string',
    needs: ['author'],
    hooks: {
      // `authorId` is now on `item`; previously only `author` was.
      resolveOutput: ({ item }) => `${item.author?.name ?? '?'} (${item.authorId})`,
    },
  })
  ```

  A `needs` entry naming a field the list does not have is dropped rather than
  typed, the list's system fields are its actual ones (a list with
  `db.timestamps: false` carries only `id`), and only a **virtual** field gets
  this narrowed `item` — a stored field's `resolveOutput` still sees the whole
  row, which is what the runtime hands it.

- **A write input is checked against the contract's columns.** A system-filled
  column (`id`, `createdAt`, `updatedAt`) is not writable, a non-nullable column
  with no default is required on create, and an unknown key is rejected.
- **Every write terminal admits silent denial.** `create` returns
  `Row | null`, and `createMany` / `updateMany` — which run one secured write
  per item — return `(Row | null)[]`, so a partially denied batch is visible in
  the type. Code that used a create result without checking now fails `tsc`:

  ```typescript
  const post = await context.db.post.create({ data })
  if (!post) return { error: 'Access denied' }
  ```

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

`StackContext`'s first parameter is now the generated `db` surface, not the
client, and refuses one: a stale `StackContext<MyPrismaClient>` fails its
constraint rather than silently meaning `db: MyPrismaClient`.

`pnpm generate` now refuses two configs it used to emit uncompilable code for:
a virtual field with no declared `outputType`, and two lists whose generated
names collide (`Post` and `PostList` both want `PostList`). Both errors name the
list and field involved.

The bundle's type-only import of the emitted declarations is now
`'../prisma/contract.d.js'`. `'../prisma/contract.d.ts'` resolved to the
Contract module sitting beside it, so `Contract` was not among the exports the
import found; re-run `pnpm generate`.
