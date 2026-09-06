# The generated types declare the contract remainder and instantiate core's generics

Status: accepted

`.opensaas/types.ts` is 1321 lines for the blog example because it re-derives, per list, every shape the ORM's own types already carry — scalar read and write types, nullability, relation arity, `select`/`include` narrowing — and then intersects our additions on top. [ADR-0040](0040-the-generator-emits-a-typescript-contract-module-not-psl.md) decided the file "shrinks to what `contract.d.ts` cannot express" and named four candidates; three later records ([ADR-0041](0041-the-secured-surface-is-an-opaque-wrapper-over-a-prisma-8-collection.md), [ADR-0048](0048-the-deleted-psl-constructs-become-config-defaults-not-ddl.md), [ADR-0051](0051-declared-dependencies-are-an-emitted-one-hop-set.md)) took items off that list. This record says what is left.

**The file survives, but it authors almost nothing.** It declares, per list, the **contract remainder** — the facts about a list that the Contract artifacts cannot carry — and then **instantiates** generic types that core exports, keyed by the generated `Contract`. Every shape that _is_ derivable from the contract is derived once, in core, and never written into generated text again.

## What the contract cannot express

Four things, and only four, are per-list facts the generator must write because no other artifact holds them:

1. **Computed field output types.** A virtual field has no column, so the contract has no type for it. Its type comes from the config's `TypeDescriptor` — a primitive string or `{ value, from, name }` — which may carry an import.
2. **Output and input overrides on stored fields.** A field whose TypeScript face differs from its codec's: `password` reads as `HashedPassword` while the column is text; `calendarDay` writes as `string` where the codec may accept more. ADR-0029 made this a legitimate, field-owned asymmetry; the contract knows only the codec.
3. **Declared dependency sets, as types.** ADR-0051 has `pnpm generate` resolve each field's `needs` into a set and emit it for the engine. The same pass emits it a second time, as a type, so a `resolveOutput` hook's `item` can be typed as exactly what the runtime hands it (below).
4. **Whether a list is a singleton.** The contract sees an integer primary key with a default; singleton-ness is a config fact that changes the surface (ADR-0039 re-derives `get()`), not a column fact.

Everything else the file writes today is in the contract and stops being written: scalar types and nullability (`FieldOutputTypes` / `FieldInputTypes`), the id type per list (ADR-0048 already reads it from `contract.d.ts`), which side of a relation owns the foreign key (`relations[].on.localFields`, which is what decides where `connect` is legal under [ADR-0050](0050-nested-relation-input-leaves-the-secured-write-surface.md)), column defaults (`execution.mutations.defaults`, which is what decides create-time optionality), relation cardinality, and each list's actual system fields.

## What the file declares

Per list, one interface for the remainder and one named interface per instantiated shape:

```ts
import type { Contract } from '../prisma/contract.d.ts'
import type { HashedPassword } from '@opensaas/stack-core'
import type {
  Row,
  StoredRow,
  CreateInput,
  UpdateInput,
  SecuredList,
  StackBaseContext,
  StackContext,
  StackTransactionContext,
  Session,
} from '@opensaas/stack-core'
import type { PluginServices } from './plugin-types.ts'

export interface Remainder {
  User: {
    computed: { displayName: string }
    output: { password: HashedPassword }
    input: {}
    needs: {}
  }
  Post: {
    computed: { excerpt: string }
    output: {}
    input: {}
    needs: { excerpt: 'content' }
  }
  Settings: { computed: {}; output: {}; input: {}; needs: {}; singleton: true }
}

export interface User extends Row<Contract, Remainder, 'User'> {}
export interface UserCreateInput extends CreateInput<Contract, Remainder, 'User'> {}
export interface UserUpdateInput extends UpdateInput<Contract, Remainder, 'User'> {}
export interface UserList extends SecuredList<Contract, Remainder, 'User'> {}
// … Post, Settings

export interface DB {
  User: UserList
  Post: PostList
  Settings: SettingsList
}
export interface BaseContext<S extends Session = Session> extends StackBaseContext<
  DB,
  S,
  PluginServices
> {}
export interface Context<S extends Session = Session> extends StackContext<DB, S, PluginServices> {}
export interface TransactionContext<S extends Session = Session> extends StackTransactionContext<
  DB,
  S,
  PluginServices
> {}
```

The `Remainder` interface is the whole of what the generator authors; the rest is names. `Row` is the read row a caller receives — the contract's output types, with the remainder's `output` overrides applied and its `computed` fields added; `StoredRow` is what a hook sees — the contract's output types with overrides but **without** computed fields, since a hook never sees a computed value (ADR-0027). `CreateInput`/`UpdateInput` are the write payload of ADR-0050 — scalars from the contract's input types with the remainder's `input` overrides, `connect` on exactly the fields the contract shows own a foreign key, required-on-create exactly where the contract shows a non-nullable column with no default. `SecuredList` is ADR-0041's opaque wrapper, whose `select`/`include` narrowing, `nearest()` and `forUpdate()` types are all core's; the remainder tells it which selectable keys are computed and must be stripped before the `Collection` sees them.

**Every one of these is a named `interface`, per [ADR-0032](0032-generated-context-and-customdb-are-interfaces-not-type-aliases.md).** That record rejected a single generic mapped type over the list-key union because each list's shapes "aren't uniformly derivable from the key alone without introducing a type-level registry indirection". The registry now exists — it is `Contract` — so the option it declined becomes the mechanism, and the rule it kept (one lazily-resolved symbol per list) is what the named instantiations preserve. This puts one constraint on core: **every generic the bundle instantiates must resolve to an object type**, because an interface cannot extend a conditional type. Core declares them as generic interfaces or mapped types over concrete keys, never as top-level conditionals.

## Hook arguments

`lists.ts` keeps `Lists.<List>.TypeInfo` as the config-facing seam — the one place the config can import types about itself without a cycle — and builds it from the same remainder:

```ts
export type TypeInfo = {
  key: 'Post'
  item: StoredRow<Contract, Remainder, 'Post'> // what a hook sees
  output: Row<Contract, Remainder, 'Post'> // what a caller receives
  inputs: {
    create: CreateInput<Contract, Remainder, 'Post'>
    update: UpdateInput<Contract, Remainder, 'Post'>
  }
  fields: { excerpt: { needs: 'content' } } // per-field remainder facts
}
```

Three consequences for how a hook is typed, all in core's generic hook types rather than generated text:

- **`item` is the stored row**, on every write-side hook. Not the read row: a hook runs before `resolveOutput` and never sees a computed value, so typing `item` with computed keys present would be a lie the compiler could not catch. `resolvedData` is our write payload, which is contract-_derived_ but not contract-_typed_ — ADR-0050 gave it a shape (`connect`, no nesting) the contract's `FieldInputTypes` does not describe.
- **A `resolveOutput` hook's `item` is `Pick<StoredRow, needs | system fields>`**, looked up from `TypeInfo['fields'][K]['needs']`. ADR-0051 made the runtime hand a hook exactly its declared set and named the cost: "a hook reading an undeclared column breaks silently". Typing the set makes that read a compile error wherever the hook is typed through `TypeInfo` — which is every hook authored under `list<Lists.Post.TypeInfo>`, the documented spelling. ADR-0025 called narrowing `item` "ergonomics on top" of the declaration constraint; with ADR-0051's runtime it is the other half of the correctness weight. A declared to-one relation is typed `StoredRow<Target> | null` and a to-many `StoredRow<Target>[]`: ADR-0051 makes the declaration outrank a field-level `read` denial, so the key is never absent, but the Access Filter still scopes rows (ADR-0025), so a to-one can be scoped away. This is our type over our behaviour and does not touch the caller-facing gap [#1072](https://github.com/OpenSaasAU/stack/issues/1072) owns.
- **Field-level value types are lookups, not a parallel map.** `TypeInfo['fields']` no longer carries each field's _config_ type — today's `Lists.Post.Fields`, from which core extracted value types by parsing `getTypeScriptType()` strings at the type level. A field `resolveInput` returns `inputs[operation][K]`; a `resolveOutput` returns `output[K]`; `needs` is constrained to `keyof item` (columns and relations, ADR-0051's widened union, and never a computed key — ADR-0027).

## Write narrowing has one source

[#608](https://github.com/OpenSaasAU/stack/issues/608) recorded two places describing a list's create input — a standalone `{List}CreateInput` and a call-site `Omit<Prisma.XCreateArgs['data'], …> & {…}` override — and asked for one. Both existed because the terminal's parameter was Prisma's type, which we could only narrow by intersection. Under ADR-0041 the terminal's parameter is ours, so the override machinery has nothing to override: `CreateInput<Contract, Remainder, 'Post'>` is both the export and the parameter. The three carve-outs where narrowing was _withheld_ (`decimal`, `bigInt`, `json` kept Prisma's wider input) invert into the default rule — a stored field's input type is its codec's input type unless the field declares an `input` override — and the one field that _wanted_ narrowing (`calendarDay`) declares it.

## The field-builder contract carries one descriptor

Four spellings today say what a field's TypeScript face is: `getTypeScriptType()`, `getTypeScriptImports()`, `resultExtension.outputType` and `VirtualField.outputType` (plus the `type: TypeDescriptor` option that feeds it). ADR-0040 already breaks the builder contract for every third-party package by replacing `getPrismaType()`; ADR-0049 fixed the column half as a structured `{ pack, type, args }`. The type half is fixed here the same way: a field config may carry **`outputType?: TypeDescriptor`** and **`inputType?: TypeDescriptor`**, the descriptor shape `virtual({ type })` already uses, and the generator collects their imports as it collects them today. For a virtual field `outputType` is required and is the remainder's `computed` entry; for a stored field either is an override into `output`/`input`, and absence means the codec's type. The four spellings are deleted.

## Considered Options

- **No generated types file — derive everything from `typeof config`.** Rejected: the config's own hooks need types about the config (`item`, `resolvedData`), so a type derived from `typeof config` that the config then imports is a cycle. This is why `lists.ts` exists in the shape Keystone's `.keystone/types` did, and nothing in Prisma 8 changes it.
- **Keep generating fully expanded per-list types**, re-targeted from `Prisma.*` at `contract.d.ts`. Rejected: it keeps a second copy of every scalar type, nullability and relation arity in a file that nothing keeps in sync with the contract — #608's drift, generalised to every field — and it is the "how much survives" ADR-0040 already answered with "shrinks substantially".
- **A pure re-export of core types with no per-list content.** Rejected as impossible rather than undesirable: computed field types, overrides, dependency sets and singleton-ness exist in no other artifact. The file authors those and nothing else, which is as close to a re-export as the facts allow.
- **Put the remainder on the Contract module** as metadata the generator reads back. Rejected on ADR-0040 — the module is standalone, fully literal and Prisma's, with no slot for a TypeScript type expression carrying an import — and on the same ground ADR-0051 refused to attach the dependency table there.
- **Derive the remainder from `typeof import('../opensaas.config')` inside `types.ts`** while the config still imports `lists.ts`. Rejected: the same cycle as the first option, one file removed.
- **Type a `resolveOutput` hook's `item` as the full stored row** and leave ADR-0051's silent break silent. Rejected: the runtime hands the hook a `Pick`, and the generator already knows the keys — typing anything wider is choosing not to catch a fault the record names as its largest cost. The mechanism is the generated per-field `needs` type, not `const`-generic inference on every field builder, because the generator has the facts and inference across a `list<T>({ fields: { … } })` literal would be fragile for third-party builders.
- **Keep `getTypeScriptType()` for stored fields as the read type, ignoring the codec.** Rejected: it is the "translate PSL types to codecs internally" option ADR-0040 already refused, in reverse — a parallel type vocabulary that hides the codec's richer types (`Char<36>`, `Numeric`, `JsonValue`) behind strings we parse ourselves.
- **Fold `lists.ts` into `types.ts`.** Deferred, not decided. Both are type-only and neither imports the config, so one file would work; two files keep the config-facing seam (`Lists`) apart from the app-facing one, which is the split ADR-0008 documents. Nothing here depends on it.

## Consequences

- **The generator's largest module becomes its smallest.** Per list it writes a `Remainder` entry and a handful of `interface X extends Generic<Contract, Remainder, 'X'> {}` lines. `StripVirtualFromArgs`, `{List}GetPayload`, `{List}Select`/`Include`/`DefaultArgs`, every `{List}Find*Args`/`{List}*Args`, `{List}VirtualFields`, `{List}TransformedFields`, `{List}Output`, `{List}WhereInput`, the legacy `{List}Hooks` and the `Fragment`/`FieldSelection` imports (deleted with the fragment API, ADR-0041) all go. `{List}Crud` is renamed: the surface is not method-shaped CRUD any more (ADR-0039).
- **Core gains the generics and loses `any`.** `Row`, `StoredRow`, `CreateInput`, `UpdateInput`, `SecuredList` and the three context interfaces are core exports keyed by `Contract` and the remainder; `PrismaClientLike = any` and the structural probing in `AccessControlledDB` are deleted, as ADR-0041 required. Core's internal bound on "some DB" is a structural interface, not `any`.
- **ADR-0051's silent break becomes a compile error for typed hooks.** A `resolveOutput` reading `item.price` without `needs: ['price']` fails `tsc` under `list<Lists.Post.TypeInfo>`. A hook authored without `TypeInfo` still breaks silently; the changeset's detection guidance stands for that case.
- **[#1072](https://github.com/OpenSaasAU/stack/issues/1072) gets its "where" answered here and keeps its "what".** A filtered-out required to-one is typed in `Row`/`SecuredList`'s include narrowing — core's generic over the contract — never in generated text. Whether that type says `| null` is that ticket's, unchanged. _(Settled by [ADR-0058](0058-a-to-one-relation-reads-as-nullable-by-arity-not-by-column.md): it says `| null`, for every to-one, by arity — core derives the include type from the contract's relation graph and never instantiates Prisma's `IncludeRelationValue`.)_
- **The field-builder break widens by one descriptor.** rag, storage and tiptap move `getTypeScriptType`/`getTypeScriptImports`/`resultExtension` to `outputType`/`inputType` alongside the column change ADR-0040 and ADR-0049 already land on them. `virtual({ type })` is unchanged in spelling.
- **App-facing names survive.** `Post`, `PostCreateInput`, `PostUpdateInput`, `Context`, `BaseContext` and `Lists.<List>.TypeInfo` keep their names, so the examples' imports do not change; what changes is that `context.db.Post` is a query-value surface and a hook's `item` is narrower.
- **The regression fixture re-targets and joins the CLI gate.** `types-large-schema.test.ts` (ADR-0032's guard) keeps its job — generate a 20-plus-list bundle and type-check it — but now needs a `contract.d.ts` to instantiate against. Until `prisma contract emit` works ([#1070](https://github.com/OpenSaasAU/stack/issues/1070)), the fixture is a checked-in `contract.d.ts` of the shape [#1032](https://github.com/OpenSaasAU/stack/issues/1032) reproduced from Prisma's own snapshot fixtures; the shape of `FieldOutputTypes`, `FieldInputTypes` and the relation types this record leans on was read from that artifact and from `orm-client.d.mts` at `8.0.0-rc.8`, not compiled.
- **The dependency set is emitted twice from one pass** — as data for the engine (ADR-0051) and as the `needs` type here. They cannot drift because the generator computes the set once and renders it in both forms; a build effort that computes them separately has reintroduced the two-walker shape ADR-0051 deleted.
- **ADR-0032 is amended**: its rejected mapped-type option is adopted now the registry exists; its interface rule stands and extends to the generics core exports. **ADR-0040 is amended**: its "shrinks to what the contract cannot express" consequence resolves to the four items above. **ADR-0051 is amended**: the emitted set also has a type-level form, and its silent-break consequence is narrowed to untyped hooks.
- **`CONTEXT.md` gains "Contract remainder"** for the per-list facts the generator authors because the contract cannot.

## Amendment — a hook's `context` is keyed too ([#1211](https://github.com/OpenSaasAU/stack/issues/1211))

The Hook arguments section above has three consequences; there is a fourth, and
it was missing rather than decided against. Every hook-args type hardcodes an
unparameterised `context`, so a hook's context statically resolves over
`PrismaClientLike = any`. `AccessControlledDB<any>` is a mapped type over
`keyof any` intersected with an index signature: it declares no named delegate,
is therefore assignable to nothing, and accepts `context.db.typoedListName`
without complaint. A consumer passing a hook's `context` into its own typed
function has no expressible spelling and must write
`context as unknown as Context`.

This record's own keying is what closes it. `TypeInfo` is the config-facing
seam, so it carries the app's `DB` alongside `item`, `output`, `inputs` and
`fields`, and core's generic hook types read `context` off it — a hook's
`context` is the same `StackContext<DB, S, PluginServices>` the generated
`Context` instantiates, not a widened one. The consequence "Core gains the
generics and loses `any`" already deletes `PrismaClientLike` and
`AccessControlledDB`'s structural probing; this says the hook args must be
keyed at the same time rather than left reading a deleted default.

Two facts about the boundary hold. `beforeTransaction` / `afterTransaction`
keep the plain base-client-bound context of ADR-0028, and a field
`resolveOutput` keeps the plain context type of ADR-0066 — both are keyed to
the same `DB`, and neither gains `sudo`/`withSession`/`transaction` here.

`main` closes this ahead of the build, threading the client type through
`TypeInfo` under the pre-contract keying (#1211). That work is not wasted and
not a second mechanism: the seam it establishes — the client type enters at
`TypeInfo`, and core's hook types read it from there — is the seam this record
keeps. What changes under the contract is only what `TypeInfo` holds.
