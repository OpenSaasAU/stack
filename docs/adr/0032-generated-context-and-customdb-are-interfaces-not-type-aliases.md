# The generated `Context`/`CustomDB` types are interfaces, not type aliases

Status: accepted

Once an application's `opensaas.config.ts` registered enough lists — reported around 7-8, schema-dependent — `tsc` started failing on `.opensaas/types.ts` with `TS2589: Type instantiation is excessively deep and possibly infinite`, on the next list registered regardless of that list's own shape (#952). Past the threshold, no further lists could be added without removing or consolidating existing ones, which only bought limited, non-durable headroom.

## Root cause

Two things compounded:

- `generateCustomDBType` built `CustomDB` as a `type` alias: `Omit<AccessControlledDB<PrismaClient>, keys> & { list1: { findUnique: ...9 methods...}, list2: { ... }, ... }` — one anonymous object-literal block, hand-unrolled per registered list, all merged into a single intersection.
- `generateContextType` built `Context` as a `type` alias whose `sudo` method returns `Context` again — self-referential.

A self-referential `type` alias is eagerly expanded wherever TypeScript checks it, and each expansion re-walks the entire (already large, growing linearly with list count) `CustomDB` intersection embedded inside it. This is the same failure mode the core `AccessContext` interface hit and fixed by dropping `sudo(): AccessContext` from that interface entirely (see `packages/core/CLAUDE.md`) — but the generated, application-facing `Context.sudo(): Context` is a documented part of the public API (`context.sudo()` is used throughout examples and docs) and can't simply be removed the way the internal one was.

## Decision

Keep `sudo()` on `Context`, but change how both types are declared:

- Each list's CRUD block is now its own named `export interface {List}Crud { ... }`, generated once per list, instead of an anonymous object literal inlined into `CustomDB`.
- `CustomDB` is declared as `export interface CustomDB extends Omit<AccessControlledDB<PrismaClient>, keys> { list1: List1Crud; list2: List2Crud; ... }` — referencing the named interfaces above rather than re-declaring their members inline.
- `BaseContext` and `Context` are declared as `interface`s (`extends`) instead of `type` aliases (`&`).

An `interface` is resolved lazily by TypeScript rather than eagerly expanded at every reference, so `Context`'s self-reference through `sudo()` no longer forces a full re-walk of `CustomDB` each time it's checked. Extracting each list's CRUD block to its own named interface gives the checker a stable, cacheable symbol per list instead of an anonymous literal re-derived as part of one large intersection.

This preserves the exact type surface: interfaces and type aliases are structurally identical for object-shaped types from a consumer's perspective — the same properties, the same generic call signatures, the same `select`/`include` narrowing via `SelectSubset`/`GetPayload<T>`. No caller-visible behavior changes; only how the declarations are spelled changes.

## Considered options

- **Replace the per-list CRUD block with a single generic mapped type over the list-key union** (`{ [K in ListKey]: ListCrudMethods }`), matching `AccessControlledDB`'s own homomorphic pattern. Rejected as the primary fix: each list's methods are parameterized by that list's own distinct `{List}FindUniqueArgs`/`{List}GetPayload<T>` types, which aren't uniformly derivable from the key alone without introducing a type-level registry indirection — a larger, riskier change for an uncertain additional gain over the interface extraction, which already gives each list's block its own lazily-resolved symbol.
- **Remove `Context.sudo()` and require callers to obtain a sudo context another way**, mirroring the core `AccessContext` fix exactly. Rejected: `context.sudo()` is public API, documented and used throughout examples; removing it is a breaking change out of proportion to the fix.
- **Leave `CustomDB` as a type alias and only convert `Context`/`BaseContext` to interfaces.** Considered, but the per-list hand-unrolled intersection is independently named in the issue's own diagnosis as a contributor, and the interface extraction is a small, mechanical change with no precision cost — there was no reason to leave it in place.

## Verification

The reported failure could not be reproduced in this repository's own toolchain — neither the pinned native TypeScript compiler nor a classic TypeScript 5.6.3 install hit `TS2589` against a synthetic 20+ list schema with relationship chains, fan-out hub relationships, several `json()` fields per list, and a real generated Prisma client, before or after this change. TypeScript's instantiation-depth budget is known to vary significantly across compiler versions and settings, and the reporter's environment (`@opensaas/stack-cli@0.39.0`, no TypeScript version given) could not be matched exactly. The fix is applied on the strength of the source-level diagnosis (self-referential type alias wrapping a per-list hand-unrolled intersection, the same pattern already found and fixed once in this codebase) rather than a locally-reproduced failing case. A permanent regression fixture (`packages/cli/src/generator/types-large-schema.test.ts`) generates and type-checks a 20+ list schema via the TypeScript compiler API, so this stays covered regardless of which compiler CI happens to run.

## Consequences

- `CustomDB`, `BaseContext`, and `Context` in `.opensaas/types.ts` are now `interface` declarations. Ordinary consumption (`context.db.<list>.*`, passing `Context`/`BaseContext` as a parameter type) is unaffected. Code relying on `type`-alias-specific behavior (e.g. distributing a union through `Context`, which an interface cannot do) would need to change, but no such usage exists in this codebase's examples or docs.
- Each list now also exports `{List}Crud` from `.opensaas/types.ts` — an additive, previously-anonymous type made nameable. Not expected to collide: it follows the same `{List}{Suffix}` naming convention as every other generated per-list type.
- **[ADR-0047](0047-a-row-lock-is-an-engine-owned-two-statement-terminal.md) adds a second generated surface shape** — a transaction-bound context carrying `forUpdate()` and `advisoryLock()` that the plain one does not. This record's rule extends to it unchanged: it is a generated `interface`, not a type alias, for the same lazy-resolution reason.

## Amendment — the registry the rejected option lacked now exists (ADR-0052)

The first rejected option above — one generic mapped type over the list-key union — was declined because each list's shapes were not "uniformly derivable from the key alone without introducing a type-level registry indirection". Under Prisma 8 that registry is the generated `Contract` type. [ADR-0052](0052-the-generated-types-declare-the-contract-remainder-and-instantiate-core-generics.md) therefore moves every contract-derivable shape into core generics keyed by `Contract` and a per-list **contract remainder**, and has the bundle instantiate them: `export interface PostList extends SecuredList<Contract, Remainder, 'Post'> {}`. The rule this record kept — one named, lazily-resolved `interface` per list and for each context shape — is unchanged and now also binds core: a generic the bundle instantiates must resolve to an object type, or an interface cannot extend it.
