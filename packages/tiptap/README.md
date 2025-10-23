# @opensaas/tiptap

Rich text editor integration for OpenSaaS Framework using [Tiptap](https://tiptap.dev).

## Features

- ✅ Rich text editing with Tiptap editor
- ✅ JSON storage in database
- ✅ SSR-safe Next.js integration
- ✅ Edit and read-only modes
- ✅ Customizable toolbar and UI options
- ✅ Full TypeScript support
- ✅ Integrates with OpenSaaS access control

## Installation

This package is designed as a separate optional dependency to keep the core framework lightweight.

```bash
pnpm add @opensaas/tiptap
```

The following peer dependencies are required:

- `@opensaas/framework-core`
- `@opensaas/framework-ui`
- `next`
- `react`
- `react-dom`

## Usage

### Basic Setup

1. **Register the field component** on the client side:

```typescript
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/framework-ui'
import { TiptapField } from '@opensaas/tiptap'

registerFieldComponent('richText', TiptapField)
```

2. **Import the registration in your admin page**:

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from "@opensaas/framework-ui";
import config from "../../../opensaas.config";
import "../../../lib/register-fields"; // Import to trigger registration

export default async function AdminPage() {
  // ... your code
  return <AdminUI config={config} />;
}
```

3. **Define your schema** with the `richText` field builder:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/framework-core'
import { text } from '@opensaas/framework-core/fields'
import { richText } from '@opensaas/tiptap/fields'

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
        }),
      },
    }),
  },
})
```

4. Generate Prisma schema:

```bash
pnpm generate
```

This will create a Prisma field with type `Json`:

```prisma
model Article {
  id        String   @id @default(cuid())
  title     String
  content   Json     // Tiptap JSON content
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

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

Rich text fields work seamlessly with OpenSaaS access control:

```typescript
Article: list({
  fields: {
    content: richText({
      validation: { isRequired: true },
      access: {
        read: () => true,
        create: isSignedIn,
        update: isAuthor,
      },
    }),
  },
})
```

### Database Operations

Content is stored as JSON and can be queried using Prisma's JSON operations:

```typescript
import { prisma } from './lib/context'

// Create article with rich text
const article = await prisma.article.create({
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
const articles = await prisma.article.findMany({
  select: {
    title: true,
    content: true,
  },
})
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

Create a custom Tiptap component with additional extensions:

```typescript
// components/CustomTiptapField.tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

export function CustomTiptapField(props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link,
      Image,
    ],
    content: props.value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      props.onChange(editor.getJSON());
    },
  });

  return <EditorContent editor={editor} />;
}
```

Then use it in your config:

```typescript
import { registerFieldComponent } from '@opensaas/framework-ui'
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

This package follows OpenSaaS's extensibility pattern:

1. **Field Builder** (`richText()`) - Defines field configuration
   - Returns `RichTextField` type
   - Implements `getZodSchema()`, `getPrismaType()`, `getTypeScriptType()`
   - Stores data as `Json` in Prisma

2. **React Component** (`TiptapField`) - UI implementation
   - Client component with `"use client"` directive
   - SSR-safe with `immediatelyRender: false`
   - Supports edit and read modes

3. **No Core Modifications** - Extends framework without changes
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
- `value: any` - JSON content value
- `onChange: (value: any) => void` - Change handler
- `label: string` - Field label
- `error?: string` - Validation error message
- `disabled?: boolean` - Disable editing
- `required?: boolean` - Show required indicator
- `mode?: "read" | "edit"` - Display mode
- `placeholder?: string` - Placeholder text
- `minHeight?: number` - Minimum height
- `maxHeight?: number` - Maximum height

## Contributing

Contributions are welcome! This package is part of the OpenSaaS Framework monorepo.

## License

MIT
