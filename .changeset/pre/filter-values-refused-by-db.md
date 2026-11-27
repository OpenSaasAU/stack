---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix admin list filters that made the read throw: integer and bigInt values outside the column range and NUL bytes now match nothing, a search too long for the where limit raises `FilterTooLongError`, and the list error panel offers "Clear filters" when the request carried a search.
