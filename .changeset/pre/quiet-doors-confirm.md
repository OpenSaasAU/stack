---
'@opensaas/stack-auth': minor
'@opensaas/stack-cli': patch
'@opensaas/stack-ui': patch
create-opensaas-app: patch
---

Add `signOutAndConfirm(auth, headers)` to `@opensaas/stack-auth/server`. It throws when better-auth swallowed a failed session delete, and returns the identity provider's logout URL for the action to redirect to. The example and generated `signOutAction` use it: `redirect((await signOutAndConfirm(auth, await headers())) ?? '/sign-in')`.
