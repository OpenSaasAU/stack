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

2. Generate Prisma schema and types:

   ```bash
   pnpm generate
   ```

3. Push schema to database:

   ```bash
   pnpm db:push
   ```

4. Start development server:

   ```bash
   pnpm dev
   ```

5. Visit http://localhost:3002/admin

## Key Files

- `opensaas.config.ts` - Configuration with `richText()` fields
- `lib/register-fields.ts` - Client-side field registration
- `app/admin/[[...admin]]/page.tsx` - Admin UI page with field registration
- `lib/context.ts` - Database context with access control

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

Then import in your admin page:

```typescript
// app/admin/[[...admin]]/page.tsx
import '../../../lib/register-fields' // Triggers registration
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

Rich text content is stored as JSON in the database:

```prisma
model Article {
  id        String   @id @default(cuid())
  title     String
  content   Json     // Tiptap JSON content
  excerpt   Json?    // Optional rich text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

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

## Learn More

- [Tiptap Documentation](https://tiptap.dev)
- [OpenSaas Documentation](https://github.com/opensaas/stack)
- [Custom Fields Guide](../custom-field/README.md)
