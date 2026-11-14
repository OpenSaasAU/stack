---
'@opensaas/stack-core': minor
---

Add the Session vocabulary: one answer, per list and context, for what a session may be told ahead of any request (ADR-0084)

A context core built carries an internal `_sessionVocabulary(listKey)` member. It answers each field's read, create and update as `'allow'`, `'deny'` or `'row-dependent'`, each list operation by the engine's own rule (no rule, `null` and `undefined` deny; `true` or a filter allows), and whether each field is filterable and sortable. A rule that throws answers deny and is logged; sudo allows everything except a hook-only field's writes. The answer is resolved once per list and kept for the context's life:

```ts
import { engineContextOf } from '@opensaas/stack-core'

const vocabulary = await engineContextOf(context)._sessionVocabulary?.('Post')
vocabulary?.operations.update // 'allow' | 'deny' | 'row-dependent'
vocabulary?.fields.get('title') // { read, create, update, filterable, sortable, relationship }
```
