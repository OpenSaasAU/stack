# Generated Prisma artifacts are committed in every example and stripped from the scaffolder's templates

Status: accepted

## Context

`opensaas generate` writes four things beside the Generated bundle: the Contract module (`prisma/contract.ts`), the two artifacts Prisma emits from it (`prisma/contract.json`, `prisma/contract.d.ts`), and the project-root `prisma.config.ts`. [ADR-0040](0040-the-generator-emits-a-typescript-contract-module-not-psl.md) commits the contract and its artifacts. [ADR-0065](0065-the-extension-contract-space-is-a-generator-emission-and-prisma-runs-create-extension.md) commits `migrations/` — the extension contract spaces the generator seeds, and the `db` ref and snapshot `prisma db update` writes, per Prisma's own model. Neither record says what happens to `prisma.config.ts`, and when the examples were found ([#1319](https://github.com/OpenSaasAU/stack/issues/1319)) all twelve carried a byte-identical copy in the Prisma 7 shape the generator had stopped emitting: a stale artifact nobody regenerated because regenerating one would make it the odd one out.

Whether the file has to be committed turns on one question: does anything read it before generation runs?

- The dev loop does not. `opensaas dev` runs `generate` before `prisma db update`, so a checkout with no `prisma.config.ts` reaches a database on its first `pnpm dev`.
- Production does. The deploy guide's release step is `prisma db migrate` from the committed `migrations/` directory, and the Prisma CLI evaluates `prisma.config.ts` for every command — it is where the migrations directory, the extension packs and the connection are named. A deploy that runs only the release step, never `generate`, needs the file in the tree it checked out.
- The determinism gate needs it too. CI regenerates the contract fixture and fails on a dirty tree; `prisma.config.ts` is one of the four files that gate compares, and a file that is not committed cannot be diffed.

The scaffolder copies its templates from `examples/starter` and `examples/starter-auth` at build time, so what the examples commit is what a scaffolded project would start with — including a `db` ref describing the example author's Dev database.

## Decision

- **Every database-backed example commits what `generate` emits, except the bundle**: `prisma.config.ts`, `prisma/contract.ts`, `prisma/contract.json`, `prisma/contract.d.ts`, and `migrations/` with its refs and snapshots. `.opensaas/` stays ignored. A config change is committed with the regenerated files beside it.
- **The generator is the only author of `prisma.config.ts`.** The ten examples not yet converted to Prisma 8 carry the file the generator emits for their config — the extension-free shape for eight of them, the pgvector shape for the two RAG examples — so all twelve agree with the generator and with each other until their own conversion regenerates them.
- **CI regenerates the converted examples and fails on a diff**, the same gate the contract fixture has. Each example converts into that gate as it lands.
- **The scaffolder strips `prisma.config.ts`, `prisma/contract.*` and `migrations/` from its templates.** The post-scaffold `generate` recreates the first three, and the first `pnpm dev` writes `migrations/` for the new project's own database. A copied `db` ref would describe a database the project does not have.

## Consequences

- A stale `prisma.config.ts` is a CI failure on a converted example, not a discovery in a pull request that happened to run `generate`.
- The dev loop dirties `migrations/` on a contributor's first reconcile of an example whose config changed; that diff is the change, and it is committed with the config.
- `packages/create-opensaas-app/src/copy-templates.ts` names the stripped paths; the scaffold first-run guard and the nightly cold-clone job both prove a scaffolded project reaches a Generated bundle and a database without them.
