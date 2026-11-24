---
'@opensaas/stack-auth': minor
---

Credential fields (`Session.token`, `Account.password`, `Verification.identifier`/`value`, and the rest of the seeded credential set, now including `oauthRefreshToken.rotationReplayResponse`) and the `Session.user` / `Account.user` foreign keys ship `create`/`update` write-denied, closing session impersonation through an owner-update rule. Reopen per operation with `authPlugin({ fieldAccess })`, which now also accepts these foreign keys. better-auth's own flows are unaffected.
