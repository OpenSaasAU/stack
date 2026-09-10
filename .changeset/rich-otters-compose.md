---
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
