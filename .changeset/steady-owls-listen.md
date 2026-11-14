---
'@opensaas/stack-core': minor
---

Add the Session vocabulary: one answer, per list and context, for what a session may be told ahead of any request (ADR-0084)

A context core built carries an internal `_sessionVocabulary(listKey)` member. It answers each field's read, create and update as `'allow'`, `'deny'` or `'row-dependent'`, each list operation by the engine's own rule (no rule, `null` and `undefined` deny; `true` or a filter allows), and whether each field is filterable and sortable. System fields (`id`, and automatic `createdAt`/`updatedAt`) have entries too, readable and never writable. A computed field and a relationship side that does not own the foreign key are never writable, and a hook-only field's writes stay denied under sudo. A rule that throws answers deny and is logged; a field rule that returns a filter rejects with `InvalidFieldAccessResultError`. The answer is resolved against the context the member is called on, once per list, and kept for that context's life (a rejection is not kept), so a hook's transaction-bound context asks the rules with itself:

```ts
import { engineContextOf } from '@opensaas/stack-core'

const vocabulary = await engineContextOf(context)._sessionVocabulary?.('Post')
vocabulary?.operations.update // 'allow' | 'deny' | 'row-dependent'
vocabulary?.fields.get('title') // { read, create, update, filterable, sortable, relationship }
```
