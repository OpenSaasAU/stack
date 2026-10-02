---
'@opensaas/stack-core': patch
---

Security fix: an access rule returning a filter that constrains nothing (`{}`, `{ AND: [] }`, `{ orgId: {} }`, or an empty predicate under a relation quantifier) now throws `VacuousAccessFilterError` instead of matching every row. A rule that meant "allow all" must return `true`.
