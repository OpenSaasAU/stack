---
'@opensaas/stack-core': minor
---

The Session vocabulary can answer its row-dependent write questions for one stored row

A consumer naming one row by its id now gets the vocabulary with each `'row-dependent'` write answer resolved for that row, against the stored row, as the write decides: core reads the row by identity exactly as an update does before it decides (every column, no relation), then answers a field's `update` against it as the row's guarded `item`, and the list's `update` and `delete` by the same target resolution a write runs (a filter-returning rule allows only a row its filter matches). A rule reaching for a relation the stored row does not carry answers deny, as the write does, and a row that is not there answers every row-dependent write question deny. A field's `read` is not resolved per row: Field Visibility decides it on each read, against the row that read delivers, so a row-dependent `read` stays `'row-dependent'`. `allow` and `deny` answers pass through without their rules being asked again, a rule that reads the payload stays `'row-dependent'`, and a rule that throws answers deny and is logged. It is disclosure only; the write still decides.

It is internal plumbing on the engine context (`_sessionVocabularyForItem(listKey, id)`), which `@opensaas/stack-ui` reads for the admin edit form and for `serializeFieldConfigs(context, listKey, 'update', item)`.
