---
'@opensaas/stack-cli': minor
'@opensaas/stack-core': patch
---

`opensaas dev` is the dev loop: it starts the Dev database, generates, reconciles and runs the app

Running `opensaas dev` in a project now starts the Dev database on a free loopback port
(persisting under `.opensaas/dev-db`, with `vector` loaded when the config declares the pgvector
pack), runs `generate`, runs `prisma db update` against it, and spawns the app — `next dev` by
default:

```bash
opensaas dev              # runs `next dev`
opensaas dev -- vitest    # runs your own command instead
```

The app child is handed **no** `DATABASE_URL` — one inherited from the environment is removed
rather than merely left uninjected: it finds the database through the state file, so
the generated runtime reports `'dev-database'` provenance and takes the single-connection binding.
`DATABASE_URL` already set is the Database escape — no Dev database starts and the environment
passes through untouched. The project's `.env` is loaded before that decision is made, the same
file the generated `prisma.config.ts` and `next dev` load, so a `DATABASE_URL` written there is
honoured rather than shadowed by a sidecar nothing uses; a shell variable still outranks the file.
The database dies with the process; `opensaas.config.ts` is still watched, and the loop shuts the
database down on every path that unwinds — a failed reconcile, a Prisma CLI that will not run, and
Ctrl-C at the consent prompt included. A `generate` that refuses ends the process outright, past
the reach of an async shutdown, so that path is covered synchronously instead: the app child is
killed and the run's state file removed.

Every Prisma CLI spawn is asynchronous now (a `spawnSync` deadlocks the socket server the Dev
database is served on), with stdin closed for `contract emit` and the terminal inherited for the
boot `db update`, so a destructive plan stops at Prisma's own consent prompt and the app is never
started.
