---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix `CreateInput`/`UpdateInput` never offering a multi-column field's assembled logical key (`db: { columns: 'keystone' }`, and `@opensaas/stack-rag`'s `embedding()`), and fix its raw physical columns leaking onto the row, create and update types instead of being hidden behind it. The generated bundle now carries one more remainder fact — which physical columns a multi-column field owns — so `context.db.Article.create({ data: { hero: uploadedFile } })` type-checks and `article.hero_url` no longer does.
