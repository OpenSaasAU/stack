---
'@opensaas/stack-tiptap': minor
---

Add `RichTextContent`, a server-side read-only renderer for `richText()` documents, from `@opensaas/stack-tiptap/render`.

```tsx
import { RichTextContent } from '@opensaas/stack-tiptap/render'
;<RichTextContent value={post.content} features={features} />
```

It renders React elements (no `dangerouslySetInnerHTML`), drops nodes, marks and attributes outside the field's feature set instead of throwing, and re-applies the link protocol policy at render time.
