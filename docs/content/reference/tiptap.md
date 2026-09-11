# Tiptap Rich Text Editor

The `@opensaas/stack-tiptap` package provides a rich text editing field for Stack using the popular [Tiptap](https://tiptap.dev) editor. This package demonstrates how third-party field packages can extend the stack without modifying the core.

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

The import is for its side effect only — it registers the component and exports
nothing you use.

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

`config` from the generated bundle is a promise — plugins resolve
asynchronously — so it is awaited here. `serverAction` is required: every
mutation the admin UI performs, rich text edits included, goes through that
wrapper. See the [UI reference](/docs/reference/ui) for the full `AdminUI` prop
set.

### 3. Use in Config

Add rich text fields to your schema:

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

Run the generator to emit the schema contract:

```bash
pnpm generate
```

`pnpm dev` applies it to the database.

`postgresql` is the only provider; the connection comes from `DATABASE_URL` (or
the Dev database `opensaas dev` starts), not from a `db.url` key. See the
[Config API reference](/docs/reference/config-api) for the complete `db` key
list.

A `richText()` field emits one `jsonb` column named after the field, holding the
Tiptap document.

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
import type { FieldAccess } from '@opensaas/stack-core'

const authorOnlyField: FieldAccess = {
  read: () => true, // Anyone can read
  create: ({ session }) => !!session, // Must be signed in to create
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

A field rule decides per fetched item and returns a **boolean**. A
filter-returning rule — the kind an operation-level `update` or `delete` takes —
is not interchangeable here: `FieldAccess` types the three slots as
boolean-returning, so passing one is a type error rather than a silent allow.

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
```

Reading is the composed read — `select()` narrows the columns, `all()` runs it,
and a denied read answers `[]`:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const articles = await context.db.Article.select('title', 'content').all()
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
    onUpdate: (props) => {
      if (isEditable && onChange) {
        onChange(props)
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
    // `item` is absent on the union's `delete` member, so narrow before
    // destructuring rather than guarding inside the body.
    afterOperation: async (args) => {
      // Side effects after save
      if (args.operation === 'create') {
        console.log('New article created with rich text', args.item.id)
      }
    },
  },
})
```

## Architecture

The Tiptap package follows OpenSaas's third-party field pattern:

### Field Builder (`richText()`)

The field builder implements the `BaseFieldConfig` interface:

- **`getContractField()`** - Returns one `pg/jsonb` column, nullable unless the field is required
- **`outputType`** / **`inputType`** - `import('@opensaas/stack-tiptap').JSONContent`, `| null` when the field is not required. An override of the column's own type: a `jsonb` codec cannot know the editor's document shape.

  The type is Tiptap's own — this package re-exports it from `@tiptap/react` — but the declared face names it through `@opensaas/stack-tiptap`, and must. The generated types are compiled in the **consuming app**, where `@tiptap/react` is this package's dependency rather than the app's, and so is not resolvable under a strict `node_modules` layout. Writing `import('@tiptap/core').JSONContent` in a field's `outputType` produces types that fail to compile there.

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
    create: ({ session }) => !!session,
    update: ({ session, item }) => !!session && item?.authorId === session.userId,
  },
})
```

### `TiptapField` Component

React component for rendering the Tiptap editor.

**Props:**

- `name: string` - Field name (for form handling)
- `value: UseEditorOptions['content']` - The Tiptap document, in the shape `useEditor` takes
- `onChange: UseEditorOptions['onUpdate']` - Change handler, called with Tiptap's whole update event (destructure the `editor` off it if that is all you need)
- `label: string` - Field label text
- `error?: string` - Validation error message
- `disabled?: boolean` - Disable editing
- `required?: boolean` - Show required indicator (\*)
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

**Solution:** Forward Tiptap's update event to `onChange` whole. `onChange` is
typed as `UseEditorOptions['onUpdate']`, so it expects the full event, not a
rebuilt `{ editor }` object and not the JSON on its own:

```typescript
const editor = useEditor({
  onUpdate: (props) => {
    onChange(props)
  },
})
```

## Learn More

- [Tiptap Documentation](https://tiptap.dev)
- [Custom Fields Guide](/guides/custom-fields)
- [Field Types Reference](/api-reference/fields)
- [Access Control Guide](/guides/access-control)
