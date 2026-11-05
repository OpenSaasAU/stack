---
'@opensaas/stack-ui': patch
'@opensaas/stack-cli': patch
---

Render the admin's Sign Out control only with an `onSignOut` handler, and stay put with an error if it rejects, so Sign Out can no longer look like it worked without ending the session.
The feature generator now emits `signOutAction` and tells you to pass it as `onSignOut`.
