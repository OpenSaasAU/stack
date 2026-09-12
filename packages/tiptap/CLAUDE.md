# @opensaas/stack-tiptap

Third-party field package providing rich text editing with Tiptap editor for OpenSaas Stack.

## Purpose

Demonstrates how to create third-party field packages that extend OpenSaas Stack without modifying core. Provides production-ready rich text editing with JSON storage.

## Key Files & Exports

### Field Builder (`src/fields/richText.ts`)

- `richText(options?)` - Field builder function
- Returns `RichTextField` type implementing `BaseFieldConfig`
- Members: `getZodSchema()`, `getContractField()`, `outputType`/`inputType`

### Component (`src/components/TiptapField.tsx`)

- `TiptapField` - React component (client component)
- Uses Tiptap editor with StarterKit
- Supports edit/read modes, custom toolbar

### Cell (`src/components/TiptapCell.tsx`)

- `TiptapCell` - List-table rendering of a `richText()` value: a short
  plain-text excerpt extracted from the Tiptap document, never the raw JSON

### Main Exports (`src/index.ts`)

- Re-exports the field builder and both components
- Separate exports for `/fields` and `/components/register`

## Architecture

### Self-Contained Field Pattern

Complete third-party field implementation:

```typescript
// Field builder
export function richText(options) {
  return {
    type: 'richText',
    ...options,
    outputType: face,
    inputType: face,
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'jsonb' },
      nullable: !options?.validation?.isRequired,
    }),
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
import '@opensaas/stack-tiptap/components/register'
```

`@opensaas/stack-tiptap/components/register` registers both `TiptapField` (the form
component) and `TiptapCell` (a plain-text excerpt for the list-table view) against the
admin UI's registries as a side effect. That module is `'use client'`, so a bare
side-effect import of it from the server component `page.tsx` never runs in the browser.
Carry it in a client component and render that:

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
;<>
  <FieldRegistration />
  <AdminUI {...props} />
</>
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

### 1. Field Builder with Required Members

```typescript
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
} from '@opensaas/stack-core/extend'
import { z } from 'zod'

export type RichTextField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'richText'
  validation?: { isRequired?: boolean }
}

const JSON_CONTENT = "import('@opensaas/stack-tiptap').JSONContent"

export function richText(options?: Omit<RichTextField, 'type'>): RichTextField {
  const isRequired = options?.validation?.isRequired === true
  const face = isRequired ? JSON_CONTENT : `${JSON_CONTENT} | null`

  return {
    type: 'richText',
    outputType: face,
    inputType: face,
    ...options,
    getZodSchema: (fieldName, operation) => {
      // Tiptap emits a nested JSONContent structure; accept any valid JSON.
      const base = z.any()
      if (!isRequired) return base.optional()
      // A partial update may omit a required field; a create may not.
      return operation === 'update' ? z.union([base, z.undefined()]) : base
    },
    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'jsonb' },
      nullable: !isRequired,
    }),
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
import '@opensaas/stack-tiptap/components/register'
```

Registers both `TiptapField` (the form component) and `TiptapCell` (the list-table
cell) under `richText` — see `src/components/register.ts`.

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
│   │   ├── TiptapField.tsx   # React component (form)
│   │   ├── TiptapCell.tsx    # React component (list-table cell)
│   │   └── register.ts       # Registers both against the admin UI's registries
│   ├── config/
│   │   └── types.ts          # Type definitions
│   └── index.ts              # Public exports
├── package.json
└── README.md
```

## Exports

The package declares three subpaths, and nothing else resolves:

```typescript
// Root: the field builder, both components and their types
import { richText, TiptapField, TiptapCell } from '@opensaas/stack-tiptap'

// The field builder on its own, for a config that never touches the components
import { richText } from '@opensaas/stack-tiptap/fields'

// Registers TiptapField and TiptapCell against the admin UI's registries
import '@opensaas/stack-tiptap/components/register'
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
