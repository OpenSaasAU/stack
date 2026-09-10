# Tiptap Rich Text Editor Demo

This example demonstrates how to use the `@opensaas/stack-tiptap` package to add rich text editing capabilities to your OpenSaas application.

## Features

- **Rich text editing** with Tiptap editor
- **JSON storage** in database
- **Multiple rich text fields** (article content and excerpt)
- **Customizable UI** (placeholder, min/max height)
- **Full access control** integration
- **Auto-slug generation** from title

## Getting Started

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Set up environment:

   ```bash
   cp .env.example .env
   ```

3. Generate the Contract module and types:

   ```bash
   pnpm generate
   ```

4. Start development server:

   ```bash
   pnpm dev
   ```

5. Visit http://localhost:3002/admin

## Key Files

- `opensaas.config.ts` - Configuration with `richText()` fields
- `lib/register-fields.ts` - Client-side field registration
- `app/admin/[[...admin]]/FieldRegistration.tsx` - the client component that carries that import into the browser
- `app/admin/[[...admin]]/page.tsx` - Admin UI page, rendering `<FieldRegistration />`
- `prisma/contract.ts` - the generated Contract module (commit it; `pnpm generate` rewrites it)
- `tests/rich-text-round-trip.test.ts` - the round-trip proof (`pnpm test`)

## Using the Rich Text Field

### Step 1: Register the Component

**Important:** Field components must be registered on the client side before rendering.

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)
```

A bare side-effect import of that module from `page.tsx` does **not** register anything: `page.tsx` is a
server component, and a `'use client'` module only reaches the browser when something in the tree renders
it. Carry it in a client component and render that component:

```tsx
// app/admin/[[...admin]]/FieldRegistration.tsx
'use client'

import '../../../lib/register-fields'

export function FieldRegistration() {
  return null
}
```

```tsx
// app/admin/[[...admin]]/page.tsx
import { FieldRegistration } from './FieldRegistration'

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  return (
    <>
      <FieldRegistration />
      <AdminUI {...adminProps} />
    </>
  )
}
```

### Step 2: Use in Config

```typescript
import { richText } from '@opensaas/stack-tiptap/fields'

fields: {
  content: richText({
    validation: { isRequired: true },
  })
}
```

### With Custom UI Options

```typescript
content: richText({
  validation: { isRequired: true },
  ui: {
    placeholder: 'Write your content here...',
    minHeight: 300,
    maxHeight: 800,
  },
})
```

### Optional Field

```typescript
excerpt: richText({
  ui: {
    placeholder: 'Write a brief excerpt...',
    minHeight: 150,
  },
})
```

## Database Storage

Rich text content is stored as a Postgres `jsonb` column. There is no
`schema.prisma`: `pnpm generate` emits `prisma/contract.ts`, the Contract
module, and this example's `Article` comes out as

```typescript
const model_Article = (models.Article = model('Article', {
  fields: {
    id: field.id.uuidv7Native(),
    title: field.text(),
    slug: field.text().unique(),
    content: field.json(), // Tiptap JSON content
    excerpt: field.json().optional(), // Optional rich text
    publishedAt: field.column(timestamptzStringColumn).optional(),
    authorId: field.uuidNative().optional().column('author'),
  },
  relations: {
    author: rel.belongsTo(() => models.User, { from: 'authorId', to: 'id' }),
  },
}))
```

`createdAt`/`updatedAt` are not added for you — auto-timestamps are off by
default (ADR-0004), and this example does not opt in.

## Editor Features

The Tiptap editor includes:

- **Text formatting**: Bold, italic, strike-through
- **Headings**: H1, H2, H3
- **Lists**: Bullet and ordered lists
- **Blockquotes**: For quotes and callouts
- **Read/Edit modes**: Toggle between viewing and editing

## Extending the Editor

To add more Tiptap extensions, create a custom field component:

```typescript
import { TiptapField } from '@opensaas/stack-tiptap'
import { registerFieldComponent } from '@opensaas/stack-ui'

// Register custom editor with additional extensions
registerFieldComponent('richTextExtended', CustomTiptapField)

// Use in config
fields: {
  content: richText({
    ui: { fieldType: 'richTextExtended' },
  })
}
```

## Testing

`tests/rich-text-round-trip.test.ts` proves the round-trip: it stands up a real
Dev database with `createTestContext` from `@opensaas/stack-core/testing`,
writes a nested Tiptap document through the secured context, edits it, and
reads it back. No database of your own is needed.

```bash
pnpm test
```

## Learn More

- [Tiptap Documentation](https://tiptap.dev)
- [OpenSaas Documentation](https://github.com/opensaas/stack)
- [Custom Fields Guide](../custom-field/README.md)
