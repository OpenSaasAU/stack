---
'@opensaas/stack-cli': minor
---

`opensaas dev` now watches the modules a split `opensaas.config.ts` imports — a database adapter, a custom field component, anything the config pulls in from its own project — not just the config file itself. Editing one of those modules now stages and reconciles automatically, the same way editing the config does; `pnpm db:update` is no longer the only route for that kind of change (it's still the way to retry after a reconcile that failed).

Only project-local modules are watched — a dependency resolved into `node_modules` never is. Reconciling still compares bytes, never generated output, so a save that changes nothing (in the config or in any watched module) still reconciles nothing.
