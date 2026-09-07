---
'@opensaas/stack-core': minor
'@opensaas/stack-rag': minor
---

A plugin's write of a column it owns runs no hook, which stops it destroying derived fields

An embedding is write-denied to application code, so the RAG plugin's generation hook
wrote it through `sudo().db.<list>.update()`. That is an ordinary secured write, so it
re-ran the list's **whole** hook pipeline carrying the embedding column and nothing else —
and a list-level `resolveInput` that derives one field from other input, the pattern
`CLAUDE.md` documents, then recomputed the derived field from values that were not there:

```typescript
Article: list({
  fields: {
    title: text(),
    body: text(),
    content: text(),
    contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
  },
  hooks: {
    // Ran a second time on the plugin's write, with `title` and `body` absent
    resolveInput: ({ resolvedData }) => ({
      ...resolvedData,
      content: [resolvedData.title, resolvedData.body].join(' '),
    }),
  },
})
```

`create({ data: { title: 'red', body: 'hot' } })` committed `content: 'red hot'` and then
overwrote it with `' '` — the join of two `undefined`s — and embedded that. No error, no
log: the row and its vector were both silently wrong. The write threw on every invocation
before the Write Pipeline landed, so this was only reachable once generation began running.

The plugin's write no longer goes through `context.db`. Core owns it as a single-field
write, `writePluginOwnedField`, exported from `@opensaas/stack-core/extend` for any plugin
that injects a field it computes:

```typescript
import { writePluginOwnedField } from '@opensaas/stack-core/extend'

runtime: (context) => ({
  [WRITE_VECTOR]: async (listName, id, fieldName, fieldConfig, value) =>
    await writePluginOwnedField({ context, listName, id, fieldName, fieldConfig, value }),
})
```

It splits the value through the field's own `splitColumns` exactly as the Write Pipeline
does, issues one scoped `UPDATE`, and runs no hook. It reaches no other field — a narrower
capability than the escalated `db` update it replaces, which could write any column on the
row. It takes the `AccessContext` `Plugin.runtime` receives as its first argument; the
`StackContext` `getContext` returns carries no ORM handle and is refused by name. See
ADR-0066.

What changes for an application: a list hook no longer fires a second time when the plugin
writes a generated column, so one logical change now fires one side effect. Nothing about
`context.db` changes — an application write runs the pipeline exactly as before, and
`embedding({ allowManualWrites: true })` still writes through it.
