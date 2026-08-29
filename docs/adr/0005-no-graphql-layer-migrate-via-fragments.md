# The stack has no GraphQL layer; Keystone GraphQL migrates via fragments + an agent skill

The OpenSaaS Stack deliberately exposes only `context.db.*` and provides no GraphQL server, schema, or typed-document runtime. A Keystone project's `context.graphql.run`/`context.query.*` surface — including large gql.tada codebases — is migrated to `context.db.*` with `defineFragment`/`ResultOf` for composable typed reads, assisted by the `migrate-context-calls` skill in the `opensaas-migration` plugin.

## Decisions

- **No GraphQL adapter.** We will not ship an optional GraphQL server to preserve existing gql.tada surfaces. It would reintroduce the runtime the stack was designed to drop, carry ongoing schema/maintenance cost, and split the access-control story across two execution paths.
- **No standalone AST codemod tool.** Mechanical `context.graphql.run` → `context.db.*` rewriting is reliable only for trivial CRUD; nested/relational queries and where-shape differences need judgement. That judgement lives in an agent skill (`migrate-context-calls`), not a deterministic ts-morph CLI.
- **Fragments are the parity story.** `defineFragment` + `ResultOf` (in `@opensaas/stack-core`) replace GraphQL fragments and codegen — composable, reused, and type-inferred without a build step. **Superseded by [ADR-0041](0041-the-secured-surface-is-an-opaque-wrapper-over-a-prisma-8-collection.md):** the fragment API is deleted in the Prisma 8 migration. Its mechanism is native there — `.select()` narrows the result type and composes inside `.include()` at every level — and its motivation was Keystone parity, which the Prisma 8 map ruled out of scope. Reuse returns as an ordinary function returning a composed query value, which needs no bespoke type.
- **The migration guide and skill carry the specifics** migrators trip on: Keystone-relation-filter → Prisma scalar-FK where-shape translation, `connect`/`disconnect`/`set` nested-write mapping, gql.tada typed-document → `defineFragment` replacement, and fragment → Prisma `include`/`select` with null-on-access-denied semantics.

## Why this is worth recording

"Where's the GraphQL?" is the first question every Keystone migrator asks, and a reasonable reader will assume an adapter should exist or will propose building one. Recording that the absence is deliberate — and that the supported path is fragments plus an agent-assisted rewrite rather than a compatibility layer — stops that work from being reopened, and explains why migration effort is concentrated in a skill and a guide rather than a package.
