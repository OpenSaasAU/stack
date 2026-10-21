---
'@opensaas/stack-tiptap': minor
---

Add `richText({ features })`, a feature set that the server enforces on writes and the editor and toolbar are built from

```typescript
import { richText, defaultRichTextFeatures } from '@opensaas/stack-tiptap/fields'

body: richText({ features: { ...defaultRichTextFeatures, link: {} } })
```

A declared set replaces the default. Writes containing any other node, mark or attribute are refused, and link `href` is limited to `http`, `https`, `mailto` and `tel` (configurable via `link.protocols`).

The default set no longer allows link, code, code block, horizontal rule or underline. Previously stored documents that use them fail on their next save unless the field declares those features.
