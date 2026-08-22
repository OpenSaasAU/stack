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

A denied field is stripped from a returned row, not an error — a `context.db` read on an opened list still succeeds and returns every other field, including a `findUnique` lookup that selects the row **by** the denied field itself (e.g. `context.db.session.findUnique({ where: { token } })` still finds the session; the returned `token` comes back stripped). Naming a denied field in `findMany`'s (or `count`'s) `where`/`orderBy` is different: the existing predicate-time read-access check (`validateQueryFieldReadAccess`) throws a `ValidationError` there instead, the same as it already does for any other field-level `read` deny. `sudo()` bypasses both — it's the supported path for an application with a genuine need. Sign-in, session refresh, email verification, and password reset are unaffected — better-auth's own flows write through the raw Prisma adapter, bypassing access control entirely.

If your application opens one of these lists today and deliberately reads one of these fields through `context.db` — a returned row, a `findMany`/`count` predicate, or a `findUnique` selector — switch that access to `context.sudo().db...`. See ADR-0036.
