---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Refuse `Object.prototype` member names (`constructor`, `__proto__`, `toString`) as unqueryable fields, unknown payload keys, filter tokens and admin list URLs, and reject non-scalar cursor values.
