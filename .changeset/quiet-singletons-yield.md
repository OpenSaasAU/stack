---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

The singleton view, and a readable list view's Create and Delete, now read the Session vocabulary

`SingletonView` shows its editor only when the session's vocabulary for the singleton allows `query`, and offers its create-on-first-save form only where `create` is not denied. An operation rule returning `null` or `undefined` now hides the editor, as the engine already denied the read (#2382), and a sudo context on a singleton with no operation rules sees the editor. A query-denied singleton renders the same unavailable state the list view does (`data-slot="singleton-view-unavailable"`), and `get()` is not called for it.

On a readable list, the Create link and the table's Delete are offered only where the vocabulary does not deny `create` or `delete`. `ui.hideCreate` and `ui.hideDelete` still hide them on top of that.

The admin package's own access classification (`isOperationPotentiallyAllowed`, `isFieldPotentiallyWritable`, `markWriteDeniedFields`) is deleted. Nothing in the admin calls an access rule or the field-access evaluator: every affordance reads the vocabulary core resolves, so a write rule that optional-chains `item` is answered as row-dependent rather than as a static deny (#2383).
