---
'@opensaas/stack-core': minor
---

Add the Session vocabulary: one answer, per list and context, for what a session may be told ahead of any request (ADR-0084)

A context core built carries an internal `_sessionVocabulary(listKey)` member. It answers each field's read, create and update as `'allow'`, `'deny'` or `'row-dependent'`, each list operation by the engine's own rule (no rule, `null` and `undefined` deny; `true` or a filter allows), and whether each field is filterable and sortable. System fields (`id`, and automatic `createdAt`/`updatedAt`) have entries too, readable and never writable. A computed field and a relationship side that does not own the foreign key are never writable, and a hook-only field's writes stay denied under sudo. On a singleton list, `delete` is denied for every session, sudo included, and no field is filterable or sortable. A rule that throws, or a field rule that returns a filter, answers deny for that one question and is logged, so one broken rule never takes the rest of the list with it. Each context resolves with its own session and connection, once per list, and keeps the answer for its life: a write's transaction-bound hook context and its `afterTransaction` context each have their own, and a `resolveOutput` hook shares the answer of the read that ran it:

```ts
import { engineContextOf } from '@opensaas/stack-core'

const vocabulary = await engineContextOf(context)._sessionVocabulary?.('Post')
vocabulary?.operations.update // 'allow' | 'deny' | 'row-dependent'
vocabulary?.fields.get('title') // { read, create, update, filterable, sortable, relationship }
```
