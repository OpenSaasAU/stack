# @opensaas/stack-tiptap

Rich text editor integration for OpenSaas Stack using [Tiptap](https://tiptap.dev).

## Features

- ✅ Rich text editing with Tiptap editor
- ✅ JSON storage in database
- ✅ SSR-safe Next.js integration
- ✅ Edit and read-only modes
- ✅ Customizable toolbar and UI options
- ✅ Full TypeScript support
- ✅ Integrates with OpenSaas access control

## Installation

This package is designed as a separate optional dependency to keep the core stack lightweight.

```bash
pnpm add @opensaas/stack-tiptap
```

The following peer dependencies are required:

- `@opensaas/stack-core`
- `@opensaas/stack-ui`
- `next`
- `react`
- `react-dom`

## Usage

### Basic Setup

1. **Register the field component** on the client side:

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)
```

2. **Import the registration in your admin page**:

The registration import is for its side effect only. `config` from the generated
bundle is a promise — plugins resolve asynchronously — so it is awaited.
`serverAction` is required: every mutation the admin UI performs goes through
that wrapper.

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'
import '@/lib/register-fields'

async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext()
  return context.serverAction(props)
}

export default async function AdminPage() {
  return (
    <AdminUI context={await getContext()} config={await config} serverAction={serverAction} />
  )
}
```

3. **Define your schema** with the `richText` field builder:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { richText } from '@opensaas/stack-tiptap/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Article: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: richText({
          validation: { isRequired: true },
        }),
      },
    }),
  },
})
```

4. Generate the schema contract:

```bash
pnpm generate
```

A `richText()` field emits one `jsonb` column named after the field, holding the
Tiptap document. `postgresql` is the only provider, and the connection comes
from `DATABASE_URL` (or the Dev database `opensaas dev` starts) rather than a
`db.url` key — see the
[config API reference](https://stack.opensaas.au/docs/reference/config-api).

### Field Options

#### Validation

```typescript
content: richText({
  validation: {
    isRequired: true, // Make field required
  },
})
```

#### UI Customization

```typescript
content: richText({
  ui: {
    placeholder: 'Start writing...',
    minHeight: 200, // Minimum editor height in pixels
    maxHeight: 800, // Maximum editor height (scrollable)
  },
})
```

### Access Control

Rich text fields work seamlessly with OpenSaas access control:

```typescript
import type { FieldAccess } from '@opensaas/stack-core'

const authorOnlyField: FieldAccess = {
  read: () => true,
  create: ({ session }) => !!session,
  update: ({ session, item }) => !!session && item?.authorId === session.userId,
}

Article: list({
  fields: {
    content: richText({
      validation: { isRequired: true },
      access: authorOnlyField,
    }),
  },
})
```

A field rule returns a **boolean** — it decides per fetched item. A
filter-returning rule, the kind an operation-level `update` or `delete` takes,
is a type error in these slots rather than a silent allow.

### Database Operations

Content is stored as JSON and read and written through the secured surface like
any other field. `create` returns `null` when the write is denied, so check it
before using the row:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const article = await context.db.Article.create({
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

if (article === null) {
  throw new Error('Not allowed to create an article')
}

const articles = await context.db.Article.select('title', 'content').all()
```

## Component Features

The `TiptapField` component includes:

### Text Formatting

- **Bold**
- _Italic_
- ~~Strike-through~~

### Headings

- H1, H2, H3

### Lists

- Bullet lists
- Ordered lists

### Blockquotes

- Quote blocks

### Modes

- **Edit mode**: Full toolbar with all formatting options
- **Read mode**: Render-only view (no toolbar)

## Advanced Usage

### Custom Field Component

Create a custom Tiptap component with additional extensions. Type it as
`TiptapFieldProps` so it drops into the registry in place of the built-in field,
and forward Tiptap's update event to `onChange` whole — `onChange` is
`UseEditorOptions['onUpdate']`, so a rebuilt `{ editor }` object or the bare JSON
will not do:

```typescript
// components/CustomTiptapField.tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import type { TiptapFieldProps } from '@opensaas/stack-tiptap'

export function CustomTiptapField({ value, onChange }: TiptapFieldProps) {
  const editor = useEditor({
    extensions: [StarterKit, Link, Image],
    content: value,
    immediatelyRender: false,
    onUpdate: (props) => {
      if (onChange) {
        onChange(props)
      }
    },
  })

  return <EditorContent editor={editor} />
}
```

Then use it in your config:

```typescript
import { registerFieldComponent } from '@opensaas/stack-ui'
import { CustomTiptapField } from './components/CustomTiptapField'

// Global registration
registerFieldComponent('richTextExtended', CustomTiptapField)

// Use in config
fields: {
  content: richText({
    ui: { fieldType: 'richTextExtended' },
  })
}

// Or per-field override
fields: {
  content: richText({
    ui: { component: CustomTiptapField },
  })
}
```

## Architecture

This package follows OpenSaas's extensibility pattern:

1. **Field Builder** (`richText()`) - Defines field configuration
   - Returns `RichTextField` type
   - Implements `getZodSchema()` and `getContractField()`, and declares `outputType`/`inputType`
   - Stores data in a `jsonb` column

2. **React Component** (`TiptapField`) - UI implementation
   - Client component with `"use client"` directive
   - SSR-safe with `immediatelyRender: false`
   - Supports edit and read modes

3. **No Core Modifications** - Extends stack without changes
   - Uses `BaseFieldConfig` extension point
   - Compatible with access control system
   - Works with hooks and validation

## Example

See `examples/tiptap-demo` for a complete working example demonstrating:

- Multiple rich text fields
- Custom UI options
- Access control integration
- Database operations

## API Reference

### `richText(options?)`

Creates a rich text field configuration.

**Options:**

- `validation.isRequired` - Make field required (default: `false`)
- `ui.placeholder` - Placeholder text (default: `"Start writing..."`)
- `ui.minHeight` - Minimum editor height in pixels (default: `200`)
- `ui.maxHeight` - Maximum editor height in pixels (default: `undefined`)
- `ui.component` - Custom React component
- `ui.fieldType` - Global field type name
- `access` - Field-level access control

**Returns:** `RichTextField`

### `TiptapField` Component

React component for rendering the Tiptap editor.

**Props:**

- `name: string` - Field name
- `value: UseEditorOptions['content']` - The Tiptap document, in the shape `useEditor` takes
- `onChange: UseEditorOptions['onUpdate']` - Change handler, called with Tiptap's whole update event (destructure the `editor` off it if that is all you need)
- `label: string` - Field label
- `error?: string` - Validation error message
- `disabled?: boolean` - Disable editing
- `required?: boolean` - Show required indicator
- `mode?: "read" | "edit"` - Display mode
- `placeholder?: string` - Placeholder text
- `minHeight?: number` - Minimum height
- `maxHeight?: number` - Maximum height

## Contributing

Contributions are welcome! This package is part of the OpenSaas Stack monorepo.

## License

MIT
