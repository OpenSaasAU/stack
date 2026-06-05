---
'@opensaas/stack-ui': minor
---

Suppress create/delete affordances and redirect sub-routes for singleton lists in the admin UI.

Singleton lists (`isSingleton: true`) have a single record edited at their bare `[list]` route, so the create and delete affordances no longer apply:

- The Dashboard "Quick Actions" no longer renders a "Create {list}" link for singletons (only standard lists). The Quick Actions card is hidden entirely in a singleton-only admin.
- The singleton editor (`SingletonView`) no longer renders a Delete control. A new optional `canDelete` prop (default `true`) on `ItemFormClient` controls this; non-singleton edit forms keep their Delete button.
- The singleton sub-routes `/admin/<list>/create` and `/admin/<list>/<id>` now server-side `redirect()` to the bare editor `/admin/<list>`, so old links keep working.

Non-singleton create/delete affordances and routing are unchanged.
