---
'@opensaas/stack-core': patch
---

Fix a singleton's `get({ include })` silently including a relation whole when given a nested shape (e.g. `{ take: 5 }`) instead of a boolean. It is now refused with a `ValidationError` naming the offending key, and the type only admits `true`/`false` per relation.
