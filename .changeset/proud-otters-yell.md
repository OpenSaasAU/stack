---
'@opensaas/stack-core': patch
---

MCP `query`'s id boundary coercion (ADR-0048) now walks the whole `where` predicate — every `AND`/`OR`/`NOT` branch, a relation quantifier's nested predicate (against the related list's own id strategy), and a nested relation-entry `where` inside a `fields` projection — instead of only the top level. A malformed id anywhere in that tree now refuses the whole request, the same answer `update`/`delete` already give, rather than silently matching nothing (which would widen a result under `NOT`).
