# @opensaas/stack-tiptap

Third-party field package providing rich text editing with Tiptap editor for OpenSaas Stack.

## Purpose

Demonstrates how to create third-party field packages that extend OpenSaas Stack without modifying core. Provides production-ready rich text editing with JSON storage.

## Key Files & Exports

### Field Builder (`src/fields/richText.ts`)

- `richText(options?)` - Field builder function
- Returns `RichTextField` type implementing `BaseFieldConfig`
- Methods: `getZodSchema()`, `getPrismaType()`, `getTypeScriptType()`

### Component (`src/components/TiptapField.tsx`)

- `TiptapField` - React component (client component)
- Uses Tiptap editor with StarterKit
- Supports edit/read modes, custom toolbar

### Main Exports (`src/index.ts`)

- Re-exports field builder and component
- Separate exports for `/fields` and `/components`

## Architecture

### Self-Contained Field Pattern

Complete third-party field implementation:

```typescript
// Field builder
export function richText(options) {
  return {
    type: 'richText',
    ...options,
    getPrismaType: () => ({ type: 'Json', modifiers: '' }),
    getTypeScriptType: () => ({ type: 'any', optional: !options?.validation?.isRequired }),
    getZodSchema: (fieldName, operation) => {
      return operation === 'create' && options?.validation?.isRequired
        ? z.any().refine((val) => val, 'Required')
        : z.any().optional()
    },
  }
}
```

### Client-Side Registration

Due to Next.js server/client boundaries:

```typescript
// lib/register-fields.ts
'use client'
import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)

// app/admin/[[...admin]]/page.tsx
import '../../../lib/register-fields' // Side-effect import
```

### JSON Storage

Content stored as Prisma `Json` type:

```prisma
model Article {
  content Json  // Tiptap JSON structure
}
```

TypeScript type:

```typescript
type Article = {
  content: any // JSON structure
}
```

## Integration Points

### With @opensaas/stack-core

- Implements `BaseFieldConfig` interface
- Works with generator system (no core changes)
- Compatible with access control and hooks

### With @opensaas/stack-ui

- Uses component registry pattern
- Receives UI options as props via pass-through
- Follows field component prop interface

### With Tiptap

- Uses `@tiptap/react` and `@tiptap/starter-kit`
- SSR-safe with `immediatelyRender: false`
- JSON content structure

## Common Patterns

### Basic Usage

```typescript
// opensaas.config.ts
import { richText } from '@opensaas/stack-tiptap/fields'

fields: {
  content: richText({
    validation: { isRequired: true },
    ui: {
      placeholder: 'Start writing...',
      minHeight: 200,
      maxHeight: 800,
    },
  })
}
```

### With Access Control

```typescript
content: richText({
  access: {
    read: () => true,
    create: ({ session }) => !!session,
    update: ({ session, item }) => session?.userId === item.authorId,
  },
})
```

### Custom Extensions

```typescript
// components/ExtendedTiptap.tsx
'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'

export function ExtendedTiptap({ value, onChange, ...props }) {
  const editor = useEditor({
    extensions: [StarterKit, Link, Image],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getJSON())
  })

  return <EditorContent editor={editor} />
}

// lib/register-fields.ts
registerFieldComponent('richTextExtended', ExtendedTiptap)

// opensaas.config.ts
content: richText({ ui: { fieldType: 'richTextExtended' } })
```

## Third-Party Field Package Requirements

This package demonstrates all requirements for third-party fields:

### 1. Field Builder with Required Methods

```typescript
export type RichTextField = BaseFieldConfig & {
  type: 'richText'
  // Custom options
}

export function richText(options?): RichTextField {
  return {
    type: 'richText',
    ...options,
    getZodSchema: (fieldName, operation) => {
      /* ... */
    },
    getPrismaType: (fieldName) => {
      /* ... */
    },
    getTypeScriptType: () => {
      /* ... */
    },
  }
}
```

### 2. React Component with Standard Props

```typescript
export interface TiptapFieldProps {
  name: string
  value: any
  onChange: (value: any) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  // Plus custom UI options
  placeholder?: string
  minHeight?: number
  maxHeight?: number
}
```

### 3. Client-Side Registration

```typescript
'use client'
import { registerFieldComponent } from '@opensaas/stack-ui'
import { TiptapField } from '@opensaas/stack-tiptap'

registerFieldComponent('richText', TiptapField)
```

### 4. SSR Safety

```typescript
const editor = useEditor({
  extensions: [StarterKit],
  content: value,
  immediatelyRender: false, // Critical for Next.js SSR
  onUpdate: ({ editor }) => onChange(editor.getJSON()),
})
```

## Package Structure

```
packages/tiptap/
├── src/
│   ├── fields/
│   │   └── richText.ts       # Field builder
│   ├── components/
│   │   └── TiptapField.tsx   # React component
│   ├── config/
│   │   └── types.ts          # Type definitions
│   └── index.ts              # Public exports
├── package.json
└── README.md
```

## Exports

```typescript
// Main export
import { richText, TiptapField } from '@opensaas/stack-tiptap'

// Subpath exports
import { richText } from '@opensaas/stack-tiptap/fields'
import { TiptapField } from '@opensaas/stack-tiptap/components'
```

## Example

See `examples/tiptap-demo` for complete working example.

## Key Principles

1. **No Core Modifications** - Extends stack via `BaseFieldConfig`
2. **Self-Contained** - All behavior in field config methods
3. **Client Registration** - Components registered on client side
4. **UI Options Pass-Through** - Custom options automatically pass to component
5. **SSR Safe** - Next.js compatible with proper hydration
6. **Type Safe** - Full TypeScript support

This package serves as reference implementation for creating third-party field packages.
