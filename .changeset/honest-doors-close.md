---
'@opensaas/stack-ui': patch
'@opensaas/stack-cli': patch
---

Render the admin's Sign Out control only with an `onSignOut` handler, instead of a button that only redirected, warn the user if the handler rejects, and reload an admin page restored from the back-forward cache.
The feature generator now emits `signOutAction` and tells you to pass it as `onSignOut`.
