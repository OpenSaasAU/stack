# A plugin's write of its own column runs no hook

Status: accepted

[ADR-0045](0045-vector-search-is-an-engine-owned-terminal-over-a-native-vector-column.md) decided that a field a plugin computes is write-denied to application code and that the plugin's own output reaches the column through an escalated write. It spelled that write `sudo().db.<list>.update({ where: { id }, data: { [field]: value } })`. [#1281](https://github.com/OpenSaasAU/stack/issues/1281) landed the Write Pipeline on the Prisma 8 collection, which made that write execute for the first time — and made it **destroy application data**. This record decides that a plugin's write of a field it owns **runs no hook**, and that core owns it as a single-field write rather than leaving a plugin to drive `sudo().db`.

## Context

Everything below was run on the Test harness (PGlite + pgvector, `createTestDatabase`, a pure-function fake provider) at `b35f316`.

- **The escalated `db` update re-runs the whole Hook Pipeline, carrying one column.** `runWritePipeline` has one input path for every create/update: `hookPipeline.run({ inputData, … })`, then `filterWritableFields`, then `beforeOperation`, the DB write, `afterOperation`, and the transaction boundary. The plugin's payload names its own field and nothing else, so every hook on that pass is handed a record that is almost entirely absent.
- **The documented derive-from-input pattern is destroyed by it.** A list-level `resolveInput` that derives `content` from `title` and `body` — the pattern the root `CLAUDE.md` documents — recomputes on the plugin's pass from two `undefined`s. Measured, unguarded: after `create({ data: { title: 'red', body: 'hot' } })` the row reads back `content: ' '`. Nothing is logged. Where the provider can embed the clobbered text, the stored vector is the vector of `' '` as well, so the row **and** its index are silently wrong; with the fake provider it instead fails the provider call and the row keeps a null embedding beside the destroyed text.
- **It is not only `resolveInput`.** On the same pass `validate` sees a mostly-absent record and can fail a write that already committed; `beforeOperation` and `afterOperation` fire a second time for one logical change — measured as `['after', 'after']` for a single `create`; and the generation hook's own `afterTransaction` re-enters itself, which only the stored `sourceHash` was stopping.
- **The bug was unreachable before #1281.** The escalated write threw on every invocation on `prisma-8`, so nothing downstream of it ran. The PR that reported generation as working is the one that made this reachable.
- **The `Derived` test fixture was defending itself against it.** `embedding-write.test.ts` guarded its `resolveInput` with `typeof resolvedData.title === 'string'`, so the test asserting "the hook embeds the persisted source" passed on the workaround rather than on the contract.
- **`sudo()` cannot carry the write anyway.** `getContext` sets `ormHandle` on the internal `AccessContext` and returns a separate `StackContext` literal that omits it; `Plugin.runtime`'s `sudo` argument is that returned context, reaching the plugin through an `as unknown as AccessContext` cast. The internal `AccessContext` core passes as `runtime`'s **first** argument is the one that carries a handle.

## Decisions

- **A plugin's write of a field it owns runs no hook.** It is not an application update: it carries the plugin's column alone, and it completes a write the application already made, whose hooks have already run against the caller's real input. Running them again over a payload that names one field lies to every one of them.
- **Core owns the write, as one field.** `writePluginOwnedField({ context, listName, id, fieldName, fieldConfig, value })`, exported from `@opensaas/stack-core/extend`, splits the value through the field's own `splitColumns` exactly as the Write Pipeline splits it and issues one scoped `UPDATE` through `secured/write.ts`, marked `withOrigin('engine')` like every other engine statement. A plugin never names a physical column itself, so ADR-0049's column layout stays core's.
- **The capability narrows.** The payload is this field's columns and nothing else. The escalated `db` update it replaces could write **any** column on the row; this cannot.
- **It takes the `AccessContext` `Plugin.runtime` receives**, not `sudo()`. A context with no `ormHandle` is refused by name (`HandlelessPluginFieldWriteError`) rather than failing as an undefined property inside the write. The RAG plugin's `runtime` no longer takes the `sudo` argument at all.
- **A row that is gone is a silent no-op**, matching every write terminal. The row is addressed by id with no Access Filter beside it — which is what the escalated write already did.
- **The fixture's guard is deleted.** `embedding-write.test.ts`'s `Derived` list now carries the unguarded derivation an application would write, and three tests pin the contract: the derived source survives the generation write, the stored vector is the vector of the real text, and one `create` fires one `afterOperation`. All three fail against the `sudo().db` write this record replaces.

## Considered options

- **Carry the persisted row into the escalated write** (`data: { ...row, [field]: value }`), so `resolveInput` recomputes the same value. Rejected: it makes the pipeline's _other_ hooks wrong instead. A field-level `resolveInput` that transforms rather than derives would re-transform its own stored output — `password()`'s hook hashes `resolvedData[fieldKey]`, so handing it back the stored hash double-hashes it, replacing one silent corruption with another. It also turns a one-column write into a whole-row write and only ever works for hooks that are pure functions of the row.
- **Skip only the list-level `resolveInput`.** Rejected: it fixes the loudest symptom and leaves the rest. `validate` still sees an absent record, the side-effect hooks still double-fire, and the generation hook still re-enters — and "which hooks run" would then depend on a rule no reader could derive from the phase order.
- **A `skipHooks` flag on the Write Pipeline, reached through `context.db`.** Rejected: it puts a hook-skipping switch on the surface application code holds, to serve a caller that needs one field. The narrow single-field write is a smaller capability and cannot be aimed at anything else.
- **Let the plugin write the columns itself off `context.ormHandle`.** Rejected: the plugin would have to name `<field>` and `<field>Metadata` and mark its own origin, which duplicates the multi-column contract ADR-0049 gives core and puts a second copy of it in every plugin that owns a column.
- **Document the corruption and ship it** (a `Known limits` entry, a changeset warning, a ticket), which is what the review asked for as the in-scope remedy. Rejected: the failure is silent, destroys user data on the documented pattern, and had no workaround an application could apply without knowing the plugin's internals. A release note is not a mitigation for that.

## Consequences

- An application's `afterOperation` no longer observes the embedding landing. It never observed it usefully — it saw a second update naming one column — and one logical change now fires one side effect.
- The `sourceHash` short-circuit keeps its remaining job: it stops an update that leaves the source text alone from paying for a second provider call. It is no longer load-bearing against re-entry, which is now structural.
- `@opensaas/stack-core/extend` gains `writePluginOwnedField`, `HandlelessPluginFieldWriteError` and `OwnedFieldLayout`. Any plugin that injects a write-denied field it computes uses it; `storage`'s multi-column fields are written by the application and are unaffected.
- ADR-0045 stands as to _why_ the write is escalated. Its spelling of that write — `sudo().db.<list>.update()` — is superseded here.
