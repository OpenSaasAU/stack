---
'create-opensaas-app': minor
---

The `with-auth` template (generated from `examples/starter-auth`) now denies self-update of `User.email` via `authPlugin({ fieldAccess })`, matching `@opensaas/stack-auth`'s new write-deny behavior (issue #1618): the template's whole-row owner-update rule on `User` no longer implies every column is writable. Changing an email address must go through better-auth's own verified change-email flow, never a direct `context.db` write.
