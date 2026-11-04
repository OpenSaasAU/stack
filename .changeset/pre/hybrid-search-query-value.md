---
'@opensaas/stack-rag': minor
---

The hybrid-search sample in the package guidance now uses the query-value surface: `context.db.Article.where({ OR: [...] }).all()` rather than the removed `findMany`.
