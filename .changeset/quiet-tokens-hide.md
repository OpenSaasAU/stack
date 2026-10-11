---
'@opensaas/stack-auth': minor
---

Read-deny `Verification.identifier` (it holds the live password-reset token), `jwks.privateKey` and `deviceCode.deviceCode`/`userCode`. These fields are now stripped from `context.db` reads, and a `where`/`orderBy` naming them throws; `sudo()` still reads them.
