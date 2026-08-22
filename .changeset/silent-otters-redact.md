---
'@opensaas/stack-core': patch
---

Fix `HashedPassword.toJSON()` returning the raw bcrypt hash, so `JSON.stringify` of a row (e.g. a server→client prop, `Response.json()`, an MCP tool response) no longer leaks the stored hash for a `password()` field.

`toJSON()` now returns `{ isSet: boolean }`, matching the redaction the admin UI already applies via `valueForClientSerialization`. `toString()`, `valueOf()`, `[Symbol.toPrimitive]`, and `==` comparison against the hash are unchanged. If you parse `JSON.stringify`'d rows and read the password field as a string, update that code to read `.isSet` instead — this is a visible output/type change on `HashedPassword.toJSON()`, though the field's read access remains the application's to configure (unchanged).
