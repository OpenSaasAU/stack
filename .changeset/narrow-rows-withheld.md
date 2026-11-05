---
'@opensaas/stack-core': patch
---

Fix a caller-shaped `combine()` rows branch, or an MCP `count` beside `take: 0`, bypassing a relationship's own `read` rule and revealing the count.
A `combine()` with a rows branch now strips as the plain include does; `count()` and a `combine()` of counts alone do not yet.
