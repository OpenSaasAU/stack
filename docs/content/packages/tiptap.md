# Tiptap Rich Text Editor

The `@opensaas/stack-tiptap` package provides a rich text editing field for OpenSaas Stack using the popular [Tiptap](https://tiptap.dev) editor. This package demonstrates how third-party field packages can extend the stack without modifying the core.

## Overview

The Tiptap package includes:

- **Rich text field type** (`richText()`) with JSON storage
- **React component** (`TiptapField`) with formatting toolbar
- **Full integration** with OpenSaas access control, validation, and hooks
- **SSR-safe** Next.js compatibility
- **Customizable UI** with options for placeholder, min/max height

## Installation

Install the package as a dependency:

```bash
pnpm add @opensaas/stack-tiptap
```

The package requires these peer dependencies (typically already in your project):

- `@opensaas/stack-core`
- `@opensaas/stack-ui`
- `next` (v15 or v16)
- `react` and `react-dom` (v19)

## Quick Start

### 1. Register the Field Component

Due to Next.js server/client boundaries, you need to register the Tiptap component on the client side:

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)
```

### 2. Import in Admin Page

Import the registration file in your admin page to trigger the side-effect:

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import config from '../../../opensaas.config'
import '../../../lib/register-fields' // Side-effect import

export default async function AdminPage() {
  return <AdminUI config={config} />
}
```

### 3. Use in Config

Add rich text fields to your schema:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { richText } from '@opensaas/stack-tiptap/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
  lists: {
    Article: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: richText({
          validation: { isRequired: true },
          ui: {
            placeholder: 'Write your article content here...',
            minHeight: 300,
            maxHeight: 800,
          },
        }),
      },
    }),
  },
})
```

### 4. Generate Schema

Run the generator to create your Prisma schema:

```bash
pnpm generate
pnpm db:push
```

This creates a `Json` field in your database:

```prisma
model Article {
  id        String   @id @default(cuid())
  title     String
  content   Json     // Tiptap JSON content
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Field Options

### Validation

Make the field required:

```typescript
content: richText({
  validation: {
    isRequired: true, // Field must have content
  },
})
```

### UI Customization

Customize the editor appearance:

```typescript
content: richText({
  ui: {
    placeholder: 'Start writing...', // Placeholder text when empty
    minHeight: 200, // Minimum height in pixels
    maxHeight: 800, // Maximum height (scrollable if exceeded)
  },
})
```

### Access Control

Rich text fields work seamlessly with field-level access control:

```typescript
import type { AccessControl } from '@opensaas/stack-core'

const isAuthor: AccessControl = ({ session, item }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

Article: list({
  fields: {
    content: richText({
      validation: { isRequired: true },
      access: {
        read: () => true, // Anyone can read
        create: ({ session }) => !!session, // Must be signed in to create
        update: isAuthor, // Only author can edit
      },
    }),
  },
})
```

## Editor Features

The Tiptap editor includes a formatting toolbar with:

### Text Formatting
- **Bold** text
- _Italic_ text
- ~~Strike-through~~ text

### Headings
- H1, H2, H3 heading levels

### Lists
- Bullet lists
- Ordered (numbered) lists

### Blockquotes
- Quote blocks for callouts

### Modes
- **Edit mode**: Full toolbar with all formatting options
- **Read mode**: Render-only view without toolbar

## Database Operations

Content is stored as JSON and can be queried using Prisma:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

// Create article with rich text
const article = await context.db.article.create({
  data: {
    title: 'My Article',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world!' }],
        },
      ],
    },
  },
})

// Query articles
const articles = await context.db.article.findMany({
  select: {
    title: true,
    content: true,
  },
})
```

## Advanced Usage

### Multiple Rich Text Fields

You can use multiple rich text fields in a single list:

```typescript
Article: list({
  fields: {
    content: richText({
      validation: { isRequired: true },
      ui: {
        placeholder: 'Write your article content here...',
        minHeight: 300,
      },
    }),
    excerpt: richText({
      // Optional field
      ui: {
        placeholder: 'Write a brief excerpt...',
        minHeight: 150,
      },
    }),
  },
})
```

### Custom Tiptap Extensions

To add additional Tiptap extensions (like Link, Image, Code Block), create a custom component:

```typescript
// components/ExtendedTiptapField.tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import CodeBlock from '@tiptap/extension-code-block'
import type { TiptapFieldProps } from '@opensaas/stack-tiptap'

export function ExtendedTiptapField({
  value,
  onChange,
  placeholder = 'Start writing...',
  minHeight = 200,
  maxHeight,
  mode = 'edit',
  disabled,
}: TiptapFieldProps) {
  const isEditable = mode === 'edit' && !disabled

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      CodeBlock,
    ],
    content: value || undefined,
    editable: isEditable,
    immediatelyRender: false, // Critical for Next.js SSR
    onUpdate: ({ editor }) => {
      if (isEditable && onChange) {
        onChange({ editor })
      }
    },
  })

  return (
    <div style={{ minHeight: `${minHeight}px`, maxHeight: maxHeight ? `${maxHeight}px` : undefined }}>
      <EditorContent editor={editor} />
    </div>
  )
}
```

Then register and use it:

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'
import { ExtendedTiptapField } from '../components/ExtendedTiptapField'

// Register default rich text
registerFieldComponent('richText', TiptapField)

// Register extended version
registerFieldComponent('richTextExtended', ExtendedTiptapField)

// Use in config with global registration
content: richText({ ui: { fieldType: 'richTextExtended' } })

// Or use per-field override
content: richText({ ui: { component: ExtendedTiptapField } })
```

### With Hooks

Rich text fields work with all OpenSaas hooks:

```typescript
Article: list({
  fields: {
    content: richText({ validation: { isRequired: true } }),
  },
  hooks: {
    resolveInput: async ({ resolvedData, operation }) => {
      // Transform content before save
      if (resolvedData.content) {
        console.log('Saving rich text content:', resolvedData.content)
      }
      return resolvedData
    },
    afterOperation: async ({ operation, item }) => {
      // Side effects after save
      if (operation === 'create') {
        console.log('New article created with rich text')
      }
    },
  },
})
```

## Architecture

The Tiptap package follows OpenSaas's third-party field pattern:

### Field Builder (`richText()`)

The field builder implements the `BaseFieldConfig` interface with three key methods:

- **`getPrismaType()`** - Returns `Json` type for database storage
- **`getTypeScriptType()`** - Returns `any` type (JSON structure)
- **`getZodSchema()`** - Returns Zod validation schema

### React Component (`TiptapField`)

The component follows standard field component props:

- Client component with `"use client"` directive
- SSR-safe with `immediatelyRender: false`
- Supports both edit and read-only modes
- Receives custom UI options via props pass-through

### No Core Modifications

The package extends the stack without modifying core:

- Uses `BaseFieldConfig` extension point
- Compatible with access control system
- Works with validation and hooks
- Integrates with component registry

## TypeScript Types

The package exports TypeScript types for all its components:

```typescript
import type { RichTextField } from '@opensaas/stack-tiptap'
import type { TiptapFieldProps } from '@opensaas/stack-tiptap'

// Field config type
const myField: RichTextField = richText({ validation: { isRequired: true } })

// Component props type (for custom components)
const MyComponent = (props: TiptapFieldProps) => {
  // Implementation
}
```

## Example Project

See the complete working example at `examples/tiptap-demo`:

- Multiple rich text fields (content and excerpt)
- Custom UI options
- Access control integration
- Auto-slug generation hook
- Database operations

Run the example:

```bash
cd examples/tiptap-demo
pnpm install
pnpm generate
pnpm db:push
pnpm dev
```

Visit http://localhost:3002/admin

## API Reference

### `richText(options?)`

Creates a rich text field configuration.

**Parameters:**
- `options` (optional):
  - `validation.isRequired` - Make field required (default: `false`)
  - `ui.placeholder` - Placeholder text (default: `"Start writing..."`)
  - `ui.minHeight` - Minimum editor height in pixels (default: `200`)
  - `ui.maxHeight` - Maximum editor height in pixels (scrollable if exceeded)
  - `ui.component` - Custom React component (per-field override)
  - `ui.fieldType` - Global field type name (component registry lookup)
  - `access` - Field-level access control
  - `hooks` - Field-level hooks (resolveInput, resolveOutput, etc.)

**Returns:** `RichTextField`

**Example:**
```typescript
const field = richText({
  validation: { isRequired: true },
  ui: {
    placeholder: 'Write here...',
    minHeight: 300,
    maxHeight: 600,
  },
  access: {
    read: () => true,
    create: isSignedIn,
    update: isAuthor,
  },
})
```

### `TiptapField` Component

React component for rendering the Tiptap editor.

**Props:**
- `name: string` - Field name (for form handling)
- `value: any` - JSON content value from Tiptap
- `onChange: (props: { editor: Editor }) => void` - Change handler
- `label: string` - Field label text
- `error?: string` - Validation error message
- `disabled?: boolean` - Disable editing
- `required?: boolean` - Show required indicator (*)
- `mode?: "read" | "edit"` - Display mode (default: `"edit"`)
- `placeholder?: string` - Placeholder text (default: `"Start writing..."`)
- `minHeight?: number` - Minimum height in pixels (default: `200`)
- `maxHeight?: number` - Maximum height in pixels (scrollable if exceeded)

**Example:**
```typescript
import { TiptapField } from '@opensaas/stack-tiptap'

<TiptapField
  name="content"
  value={content}
  onChange={({ editor }) => setContent(editor.getJSON())}
  label="Article Content"
  required
  placeholder="Write your content..."
  minHeight={300}
/>
```

### `registerFieldComponent()`

Registers a custom component for the `richText` field type.

**Parameters:**
- `fieldType: string` - Field type name (e.g., `"richText"`, `"richTextExtended"`)
- `Component: React.ComponentType` - React component to register

**Example:**
```typescript
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)
```

## Troubleshooting

### Field Not Rendering

**Problem:** The rich text field doesn't appear in the admin UI.

**Solution:** Ensure you've registered the component and imported the registration file:

```typescript
// lib/register-fields.ts must have 'use client'
// app/admin/[[...admin]]/page.tsx must import the file
import '../../../lib/register-fields'
```

### SSR Hydration Errors

**Problem:** Console shows hydration mismatch errors.

**Solution:** The TiptapField component uses `immediatelyRender: false` to prevent SSR issues. If using a custom component, ensure you include this option:

```typescript
const editor = useEditor({
  immediatelyRender: false, // Critical!
  // ... other options
})
```

### Content Not Saving

**Problem:** Editor content doesn't persist to database.

**Solution:** Ensure your `onChange` handler updates the form state correctly:

```typescript
const editor = useEditor({
  onUpdate: ({ editor }) => {
    onChange({ editor }) // Pass entire object, not just JSON
  },
})
```

## Learn More

- [Tiptap Documentation](https://tiptap.dev)
- [Custom Fields Guide](/guides/custom-fields)
- [Field Types Reference](/api-reference/fields)
- [Access Control Guide](/guides/access-control)
