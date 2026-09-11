---
'@opensaas/stack-cli': minor
---

`opensaas dev` no longer reconciles or promotes on a save that changes nothing

The loop reconciled on every watcher event, including one carrying config bytes
it had already generated from. `fs.writeFileSync` truncates then writes, which
Linux inotify can deliver as two change events for one save, so a single save
could run a second reconcile whose plan was empty — and `promoteStagedGeneration`
rewrites the live root `prisma.config.ts` as its last act, so that no-op
reconcile overwrote a committed file the user had not changed.

The loop now remembers the config source it generated from and skips a save that
reproduces it:

```
Config saved with no change: nothing to reconcile.
```

A save that does change the config behaves exactly as before: an additive edit
goes live without a restart, a destructive one waits for `pnpm db:update`, and a
config change with no schema effect (adding a `virtual()` field, say) still
promotes its regenerated bundle. The watcher also debounces with
`awaitWriteFinish`, so one save reaches it as one event.
