---
'@opensaas/stack-core': minor
---

The Session vocabulary can answer its row-dependent questions for one loaded row

A consumer holding a stored row now gets the vocabulary with each `'row-dependent'` answer resolved for that row, as the engine decides it: a field's `read` and `update` against the row's guarded `item`, and the list's `update` and `delete` by the same target resolution a write runs (a filter-returning rule allows only a row its filter matches). `allow` and `deny` answers pass through without their rules being asked again, a rule that reads the payload stays `'row-dependent'`, and a rule that throws answers deny and is logged. It is disclosure only; the write still decides.

It is internal plumbing on the engine context (`_sessionVocabularyForItem(listKey, item)`), which `@opensaas/stack-ui` reads for the admin edit form and for `serializeFieldConfigs(context, listKey, 'update', item)`.
