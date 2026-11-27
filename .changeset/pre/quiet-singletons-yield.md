---
'@opensaas/stack-ui': minor
'create-opensaas-app': patch
---

The singleton view and every Create and Delete affordance now read the Session vocabulary

`SingletonView` shows its editor only when the session's vocabulary for the singleton allows `query`, and offers its create-on-first-save form only where `create` is not denied. An operation rule returning `null` or `undefined` now hides the editor, as the engine already denied the read (#2382), and a sudo context on a singleton with no operation rules sees the editor. A query-denied singleton renders the same unavailable state the list view does (`data-slot="singleton-view-unavailable"`), and `get()` is not called for it. If reading the vocabulary throws, the singleton view logs the error and shows a load-failure state for that view (`data-slot="singleton-view-error"`) instead of failing the whole admin page. Framework control flow such as `redirect()` still propagates.

Create and Delete are offered only where the vocabulary does not deny `create` or `delete`, on top of `ui.hideCreate` and `ui.hideDelete`. This covers the list view's Create link and table Delete, the dashboard's Quick Actions Create links, and the item page's Delete. The `/create` route renders an unavailable state (`data-slot="item-create-unavailable"`) instead of a form where `create` is denied.

The admin package's own access classification (`isOperationPotentiallyAllowed`, `isFieldPotentiallyWritable`, `markWriteDeniedFields`) is deleted. Nothing in the admin calls an access rule, reads one off a config or calls the field-access evaluator: every affordance reads the vocabulary core resolves, so a write rule that optional-chains `item` is answered as row-dependent rather than as a static deny (#2383).
