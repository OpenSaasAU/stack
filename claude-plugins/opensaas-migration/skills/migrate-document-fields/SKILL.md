---
name: migrate-document-fields
description: Migrate Keystone document fields (@keystone-6/fields-document) to OpenSaaS Stack tiptap rich text fields. Invoke as a forked subagent, passing the config file path and document field details.
context: fork
agent: general-purpose
---

Migrate the Keystone document fields described below to OpenSaaS Stack's Tiptap rich text fields. This involves config changes, package updates, and a data format note for existing content.

$ARGUMENTS

## The Change

**Keystone** uses a proprietary document editor from `@keystone-6/fields-document`:

```typescript
import { document } from '@keystone-6/fields-document'

content: document({
  formatting: true,
  links: true,
  dividers: true,
  layouts: [
    [1, 1],
    [1, 1, 1],
  ],
})
```

**OpenSaaS Stack** uses Tiptap (ProseMirror-based) from `@opensaas/stack-tiptap`:

```typescript
import { richText } from '@opensaas/stack-tiptap/fields'

content: richText()
```

Both store JSON in the database, but **the JSON formats are different** (see data migration note below).

## Step 1: Update the Config

```diff
- import { document } from '@keystone-6/fields-document'
+ import { richText } from '@opensaas/stack-tiptap/fields'

  content: document({
-   formatting: true,
-   links: true,
-   dividers: true,
-   layouts: [[1, 1]],
- })
+ content: richText()
```

All document field options (`formatting`, `links`, `dividers`, `layouts`) are dropped — Tiptap's toolbar is configured at the UI level, not the field level.

## Step 2: Update package.json

The user needs to install `@opensaas/stack-tiptap` and its peer dependencies:

```bash
pnpm add @opensaas/stack-tiptap
pnpm remove @keystone-6/fields-document
```

## Step 3: Register the Tiptap UI component

In the admin page (`app/admin/[[...admin]]/page.tsx` or similar):

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { RichTextFieldComponent } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', RichTextFieldComponent)
```

Then import it in the admin page as a side effect:

```typescript
import '../../../lib/register-fields'
```

## Data Migration Note

**The Keystone document format and Tiptap's ProseMirror JSON format are different.** Existing content stored in the database will not automatically render correctly in the Tiptap editor.

If the project has existing document content that must be preserved:

- The old Keystone document JSON looks like: `[{ "type": "paragraph", "children": [{ "text": "..." }] }]` (Slate-based)
- The new Tiptap JSON looks like: `{ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }] }`

**Options:**

1. **Accept format mismatch** — old content won't render until re-saved in the new editor (acceptable for many projects)
2. **Write a data transformation script** — convert the Keystone format to Tiptap format using a Node.js script (complex, project-specific)

Write a comment in the code for any document fields that had existing content so the user knows to address it:

```typescript
// NOTE: This field was migrated from Keystone document format.
// Existing content may not render correctly until re-saved in the Tiptap editor.
// See specs/keystone-image-migration.md for data migration guidance.
content: richText()
```

## Steps

1. Read the config file to find all `document()` fields
2. Replace each with `richText()`, update imports
3. Note the package changes needed (`pnpm add @opensaas/stack-tiptap`, `pnpm remove @keystone-6/fields-document`)
4. Search for any admin page setup files to identify where the field component registration should go
5. Add the `// NOTE:` comment above each migrated field
6. Report: what was changed, what packages to install, and whether existing data may need transformation
