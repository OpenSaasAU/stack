# The staged promotion set is not atomic to an outside observer

Status: accepted

[#1300](https://github.com/OpenSaasAU/stack/issues/1300), surfaced during review of [#1296](https://github.com/OpenSaasAU/stack/pull/1296) (which fixed a test race against the loop, not the reconciler). `promoteStagedGeneration` (`packages/cli/src/dev/staged-reconcile.ts`) swaps each generated file into place atomically — a `copyFileSync` to a sibling temp name, then a same-filesystem `renameSync` — but the **set** of them is not: the filesystem offers no multi-file commit, and the moves land one at a time. Measured on `origin/prisma-8` between the first swap (`prisma/contract.json`) and the last (the project-root `prisma.config.ts`): **1–2 ms on macOS, 127 ms on a 2-CPU Linux runner**, growing under load.

## Context

A second-terminal `opensaas db update` is already safe — it serialises on the loop's own queue through the control channel and never runs concurrently with a promotion. Nothing else is: a direct `npx prisma …`, `prisma studio`, or `psql` run in another terminal reaches the filesystem with no serialisation against the loop at all, and neither does a hot-reloading `next dev` child re-importing whatever changed. `PartialPromotionError` does not cover this — it reports a promotion that **failed** part-way, not one **observed** part-way, and a successful promotion throws nothing.

Two concrete mixed states are reachable inside the window:

1. **A hot reload mid-promotion.** `.opensaas/tables.ts` — the dependency-set table ADR-0051 derives from the same computation as the Contract module, specifically so the two cannot disagree — could previously land anywhere in the unordered `readdirSync` of the bundle directory, arbitrarily far behind `prisma/contract.ts`. A reload landing in that gap could import a new contract against an old dependency table.
2. **A root config pointing forward while registering backward.** `prisma.config.ts`'s only contract-derived content is its declared extension-pack import and registration list (`packages/cli/src/generator/prisma-config.ts`). Mid-window it can register the _old_ pack list while the `prisma/contract.ts` it names is already the _new_ one.

## Decision

**The window is accepted, not eliminated**, and this record is what makes that a stated decision rather than an undocumented gap.

A fully atomic promotion was considered and rejected as disproportionate to what it would cost. The only filesystem primitive that makes a _set_ of paths flip as one op is a single `rename()` over a symlink, and the set this promotion moves cannot be reduced to one symlink without breaking a stronger, already-shipped guarantee: ADR-0067 commits `prisma/contract.ts`, `prisma/contract.json` and `prisma/contract.d.ts` to git as plain, byte-diffable files, and `prisma/` also holds the committed `migrations/` tree, which must stay a real directory across every promotion. Turning any of the promoted paths into a permanent symlink into a gitignored, dev-only generation directory would make a repository's working tree show a type change on every first `opensaas dev`, for a hazard that only exists inside `opensaas dev` in the first place — the one-shot `opensaas generate` path this reconciler doesn't touch is unaffected either way.

What this record commits to instead, all inside `promoteStagedGeneration`'s existing per-file-atomic design:

- **`prisma.config.ts` lands last, always.** This was already true by construction; it is now stated as a guarantee this function's own docblock and tests hold it to, not an incidental consequence of the order the code happened to be written in. Its landing is therefore the single signal that the _entire_ set is in place, which is exactly what the dev loop's own `Database updated and the new contract promoted.` log line — printed only after `promoteStagedGeneration` returns — reports, and what `packages/cli/tests/staged-reconcile.test.ts`'s `an additive edit goes live without a restart` waits on rather than on the app's own answer (the fix #1296 made, now backed by a stated ordering rather than a coincidental one).
- **`.opensaas/tables.ts` moves immediately after the three contract artifacts**, explicitly, rather than falling wherever an unordered `readdirSync` places it. This does not close the ADR-0051 window — nothing short of the rejected symlink scheme does — but it shrinks it from "as long as the rest of the bundle takes to enumerate and copy" to "the three contract-artifact swaps," which is the smallest this function can make it without the rejected redesign.

**Who is and isn't serialised against a live promotion:**

| Observer                                                                                                    | Serialised?                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A second-terminal `opensaas db update`                                                                      | Yes — queued through the loop's control channel; never runs concurrently with a promotion.                                                                                                                                                                                                                                                |
| The `next dev` (or other spawned) app child, on a hot reload                                                | No. It can import a module graph spanning old and new artifacts for the measured window. An additive promote deliberately does not restart the app, so this is the primary case the window matters for; a destructive promote restarts the app child regardless (ADR-0063), which bounds the same app process's own exposure to one boot. |
| A direct `prisma db update`, `prisma studio`, `prisma migrate`, or `psql` run by hand during `opensaas dev` | No. Nothing in the loop knows such a process exists.                                                                                                                                                                                                                                                                                      |
| Any process reading the promoted files mid-window                                                           | May observe a mix of old and new artifacts for up to the measured window (1–2 ms macOS, 127 ms on a loaded 2-CPU Linux runner) — including, specifically, `prisma/contract.ts` disagreeing with `.opensaas/tables.ts` for part of that window, an exception to ADR-0051's "cannot disagree" scoped to this promotion window alone.        |

## Considered options

- **A directory-symlink swap for the whole promoted set** (`.opensaas` and `prisma/contract.*` as symlinks into a per-generation directory, flipped by one `rename()`). Rejected: `prisma/contract.json` and `prisma/contract.d.ts` are committed, byte-deterministic artifacts under ADR-0067, and `prisma/` also holds the committed `migrations/` tree — neither can be replaced by a symlink into a gitignored generation directory without the working tree showing a permanent, surprising type change the moment `opensaas dev` first runs.
- **A file lock or advisory lock external processes are expected to honour.** Rejected: it would need every consumer (Prisma's own CLI, `psql`, any script) to opt in, which the stack cannot compel, and ADR-0063 already treats "a Postgres the stack does not own reached directly" as a case the loop does not try to serialise against.
- **Leave the order as incidental** (accept the risk without stating it, as `PartialPromotionError`'s docs already half-implied). Rejected: it is exactly what #1300 flags as the problem — an ordering guarantee a test now depends on (#1296) with nothing naming it as one.

## Consequences

- `promoteStagedGeneration`'s docblock in `packages/cli/src/dev/staged-reconcile.ts` states both ordering guarantees explicitly and points here.
- `packages/cli/src/dev/staged-reconcile.test.ts` gains a test asserting the swap order: the three contract artifacts, then `tables.ts`, then every other bundle file, then `prisma.config.ts` last — via `PartialPromotionError.promoted`, forcing the failure at the root config to read off the order everything ahead of it landed in.
- `packages/cli/tests/staged-reconcile.test.ts`'s existing comment on why it waits for the loop's own log line rather than the app's answer is now backed by a stated guarantee rather than an implementation detail that happened to hold.
- `CLAUDE.md`'s "Costs taken knowingly" section and `specs/prisma-8/architecture-spec.md` gain a line naming this record.
- No runtime behaviour changes for a promotion that isn't observed mid-flight; the ordering change only moves where `tables.ts` falls relative to the rest of the `.opensaas` bundle.
