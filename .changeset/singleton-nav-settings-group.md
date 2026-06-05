---
'@opensaas/stack-ui': minor
---

Add first-class singleton presentation to the admin Navigation and Dashboard

Singleton lists (`isSingleton`) are now visually distinguished from ordinary lists:

- **Navigation:** singletons render under a dedicated "Settings" group with a gear
  icon, separate from the standard "Lists" group. Each still links to its
  single-record editor (`/<basePath>/<url>`). The "Settings" group is omitted when
  there are no singletons (and the "Lists" group is omitted when there are only
  singletons).
- **Dashboard:** singletons appear in their own "Settings" section with a
  "Configure" affordance instead of the misleading "N items" count (a singleton's
  count is always 0 or 1). The Dashboard no longer calls `count()` for singletons.

Non-singleton lists are unchanged.
