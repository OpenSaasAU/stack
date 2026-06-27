---
'@opensaas/stack-core': patch
---

Enforce unique-`where` for `context.db.<list>.findUnique` — a non-unique `where` now throws a clear error instead of silently returning a nondeterministic row. Use `findFirst` for non-unique single-row lookups.
