---
'@opensaas/stack-core': minor
'@opensaas/stack-tiptap': minor
---

`richText()` is generic over `TTypeInfo`, so it composes with a typed list

Every other field builder — core's `text()`/`json()`, storage's `file()`/`image()` — carries the list's `TypeInfo` through, but `richText()` was pinned to the default. A field declared inside a `list<Lists.Article.TypeInfo>()` therefore failed to type-check with `Type 'string' is not assignable to type '"Article"'`, and the only way to use the field was to drop the generated TypeInfo from the list.

```ts
import { richText } from '@opensaas/stack-tiptap/fields'
import type { Lists } from '@/.opensaas/lists'

Article: list<Lists.Article.TypeInfo>({
  fields: {
    // now infers TTypeInfo from the surrounding list, so the field's own
    // hooks see `listKey: 'Article'` and the list's field keys
    content: richText({ validation: { isRequired: true } }),
  },
})
```

No call-site change is required: the parameter is inferred, and an untyped `list({ … })` keeps the previous default.

A required `richText()` field can also be left out of a partial update again. Its update schema was `z.union([z.any(), z.undefined()])`, which is still a _required_ key inside `z.object()`, so any update that did not mention the field — editing only an article's title, say — was refused with `expected nonoptional, received undefined`. The schema is now `.optional()`, matching core's `json()`; a present `null` is still rejected, because required means non-null.

The matching hole on **create** is closed too. The create schema was a bare `z.any()`, which inside `z.object()` rejects an absent key but accepts a present `null` or explicit `undefined` — so a required field could be created empty and the write reached a non-nullable column with nothing in it. It now carries the same refinement core's `json()` uses.

`TiptapField` no longer resets the document while you type. Its `onChange` was typed as `UseEditorOptions['onUpdate']` and handed the whole editor-update payload straight to the field's `onChange`, rather than the JSON value the field stores; the props are now `value: JSONContent | null` and `onChange: (value: JSONContent) => void`, and the component calls `editor.getJSON()` itself. The accompanying `useEffect` compared `value` against `editor.getJSON()` by identity — `getJSON()` allocates a fresh object every call, so the check never matched and `setContent` re-ran on every keystroke, dropping the caret. It now short-circuits on the object it last emitted, and otherwise compares the serialised forms, so it fires only on a genuinely external change.

**`TiptapField` also no longer reports an edit nobody made.** Two Tiptap calls emit an `update` by default, and this component forwarded both to `onChange`:

- `setContent(content)` — `emitUpdate` defaults to `true`, so mounting with a `null` value pushed `{"type":"doc","content":[{"type":"paragraph"}]}` into form state;
- `setEditable(editable)` — its second argument is `emitUpdate`, also defaulted to `true`, so merely becoming editable counted as a content change.

Between them, creating a record while touching neither rich-text field submitted both as empty documents: an **optional** `richText()` column was written an empty doc instead of `null`, and a **required** one was satisfied without the user typing anything. Both calls now pass `false`, and a suite covers mount, editability changes, the controlled keystroke round trip, an externally reloaded row, and a form resetting the field to `null`.

`formatFieldName` is now exported from `@opensaas/stack-core/extend`, the third-party field-authoring surface:

```ts
import { formatFieldName } from '@opensaas/stack-core/extend'

formatFieldName('internalNotes') // 'Internal Notes'
```

`richText()` uses it, so its validation messages address a field the same way core's `json()` does — a form carrying both no longer says `content is required` for one and `Content is required` for the other.

`@opensaas/stack-tiptap` gains a test suite (`pnpm test`); it had none. It runs under `happy-dom` so the component's behaviour is covered against a real ProseMirror document, not just the schema.
