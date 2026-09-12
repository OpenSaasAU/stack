---
'@opensaas/stack-cli': minor
---

Stage the dev loop's regeneration behind reconciliation, and add `opensaas db update`

A config edit under `opensaas dev` no longer regenerates in place. The new contract
and bundle are written to `.opensaas/staged/`, `prisma db update` is planned against
them, and they are promoted only once the plan has applied — so the app never reloads
onto a contract the database does not carry.

A plan that would destroy data is not applied. The loop prints it, leaves the database
and the bundle at the previous schema, keeps serving, and tells you to run
`pnpm db:update`:

```
This change would destroy data, so it was not applied:
  • Drop column "note" from "Note" (destructive)
    ALTER TABLE "public"."Note" DROP COLUMN "note"

The app keeps serving the previous schema. To apply it, run `pnpm db:update`
(`opensaas db update --confirm postgres`) in another terminal.
```

`opensaas db update` is that command:

```bash
opensaas db update --confirm postgres
```

It passes the consent token through to Prisma, promotes the staged artifacts, and
restarts the app child after a destructive promote — a client cached across a reload
would otherwise keep querying the dropped column. The reconcile itself runs inside the
running loop, which owns the Dev database and the migrations refs, so a second terminal
opens no connection of its own. With no loop listening, the command fails naming
`opensaas dev`. If the loop goes away part-way through an exchange, the command says so
rather than claiming no loop is running.

Staging covers the whole generation: the project-root `prisma.config.ts` is held back
with the rest and promoted with it, so a discarded `db.extensions` change leaves no
config describing extensions the contract does not carry. Promotion moves the entire
staged bundle directory — including files a plugin's `afterGenerate` wrote — and swaps
each file into place through a rename, so the running app never reads a half-written
one.

Each file lands atomically; the set of them does not. The filesystem offers no
multi-file commit, so a crash part-way through promotion leaves the bundle split across
two contracts. The loop reports the split, naming the file it stopped on, and re-running
`opensaas generate` rewrites the whole bundle from the current config.
