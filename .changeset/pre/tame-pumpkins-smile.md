---
'@opensaas/stack-ui': minor
---

Fix the admin sidebar rendering the signed-in user as the literal string `"undefined"`.

`Navigation` read the session's `name`/`email` off a `.data` property that doesn't exist on the session object — `context.session` carries the configured `sessionFields` directly — and coerced the missing value with `String(...)`, which turns `undefined` into the string `"undefined"` before the `|| 'User'` fallback could ever run. It now reads `context.session.name`/`context.session.email` directly and only falls back to `'User'`/`''` when the field is genuinely absent or not a string, so a session whose `sessionFields` doesn't include `name`/`email` renders sensibly instead of showing `undefined`.
