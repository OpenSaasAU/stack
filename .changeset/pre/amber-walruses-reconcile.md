---
'@opensaas/stack-cli': minor
---

`opensaas dev` no longer reconciles or promotes on a save that changes nothing

The loop reconciled on every watcher event, including one carrying config bytes
it had already generated from — and an identical-bytes `writeFileSync` fires a
change event of its own on every platform. `promoteStagedGeneration` rewrites
the live root `prisma.config.ts` as its last act, so that no-op reconcile
overwrote a committed file the user had not changed. (On Linux, inotify can
deliver one `fs.writeFileSync` as two events, which doubled the odds per save
but was never the cause.)

The loop now remembers the config source it generated from and skips a save that
reproduces it, naming the way out:

```
Config saved with no change: nothing to reconcile.
To regenerate and reconcile anyway — after a failed reconcile, or for a change in a
module the config imports — run `pnpm db:update` (`opensaas db update`) in another terminal.
```

That route matters because the guard compares the config's own bytes, and the
config file is all the loop watches. A change in a module the config **imports**
fires no event, and re-saving the config no longer forces a regenerate the way
it used to. `opensaas db update` regenerates from the current config — the
loader disables its module cache, so the reload re-reads every imported module —
and promotes. When a destructive change is parked, the skip says so and re-shows
the `pnpm db:update` guidance rather than going quiet.

A reconcile that fails after generating — a database briefly out of reach, say —
no longer leaves the guard armed, so saving again retries instead of reporting
that nothing changed.

A save that does change the config behaves exactly as before: an additive edit
goes live without a restart, a destructive one waits for `pnpm db:update`, and a
config change with no schema effect (adding a `virtual()` field, say) still
promotes its regenerated bundle. Whitespace- and comment-only edits still
reconcile and promote in full — the guard compares bytes, not meaning, and only
ever errs towards doing the work.

The watcher also debounces with `awaitWriteFinish`, so one save reaches it as one
event. That costs every config save at least 200ms of latency before the loop
reacts.
