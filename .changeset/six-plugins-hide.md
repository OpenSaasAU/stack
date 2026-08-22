---
'@opensaas/stack-auth': minor
---

BREAKING (pre-1.0): The derived auth lists' credential-bearing fields now ship with a field-level `read` deny, so opening operation-level access to a list no longer exposes them:

- `Session.token`
- `Verification.value`
- `Account.password`
- `Account.accessToken`
- `Account.refreshToken`
- `Account.idToken`

A denied field is stripped from the result, not an error — a `context.db` read on an opened list still succeeds and returns every other field. `sudo()` still reads all six fields, which is the supported path for an application with a genuine need. Sign-in, session refresh, email verification, and password reset are unaffected — better-auth's own flows write through the raw Prisma adapter, bypassing access control entirely.

If your application opens one of these lists today and deliberately reads one of these fields through `context.db`, that read will now come back stripped — switch it to `context.sudo().db...`. See ADR-0036.
