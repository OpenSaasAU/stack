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
  [WRITE_VECTOR]: async (listName, id, fieldName, value) =>
    await writePluginOwnedField({ context, listName, id, fieldName, value }),
})
```

It splits the value through the field's own `splitColumns` exactly as the Write Pipeline
does, issues one scoped `UPDATE`, and runs no hook.

It reaches no field but the one named, and that is enforced rather than asked of the
caller: the field is resolved against the config the context was built from, so the
columns written are that field's own and the caller passes no layout. A list or a field
the config does not declare is refused by name, as is a context carrying no config, as is
an `undefined` value — which would otherwise wipe a multi-column field and no-op a
single-column one, two outcomes for one input. This narrows the escalated `db` update it
replaces, which could write any column on the row, but it is not a privilege boundary: a
plugin holding `context.ormHandle` can already write anything, and this refuses the
mistake rather than the intent.

It takes the `AccessContext` `Plugin.runtime` receives as its first argument; the
`StackContext` `getContext` returns carries no ORM handle and is refused by name. That
second argument, `sudo`, is now declared as the `StackContext` it always was — a plugin
reaching `sudo().db` is unaffected, one reaching `ormHandle` off it was already getting
`undefined` and now fails to compile. See ADR-0066.

A write refused by name is a wiring defect that fails identically on every row, so the RAG
plugin's failure log now reports all three refusals — and `WriteCollectionMissingError`
beside them — as the standing defect they are, rather than telling the reader to retry a
write that can never succeed.

What changes for an application: a list hook no longer fires a second time when the plugin
writes a generated column, so one logical change now fires one side effect. Nothing about
`context.db` changes — an application write runs the pipeline exactly as before, and
`embedding({ allowManualWrites: true })` still writes through it.
