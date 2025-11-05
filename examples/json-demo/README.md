# OpenSaaS JSON Field Demo

This example demonstrates the JSON field type in OpenSaaS Stack, showing both the default textarea component and a custom rich JSON editor component.

## Features

### JSON Field Type

The `json()` field builder stores arbitrary JSON data in the database:

- **Type**: Uses Prisma's `Json` type (PostgreSQL/MySQL) or TEXT in SQLite
- **Validation**: Optional `isRequired` validation
- **UI Options**: Configurable placeholder, rows, and formatting
- **Type Safety**: TypeScript type is `unknown` (can be narrowed with custom types)

### Default Component

The default `JsonField` component provides a simple textarea with:

- **JSON Validation**: Real-time parsing with error messages
- **Auto-formatting**: Optional pretty-printing with indentation
- **Read Mode**: Displays formatted JSON in a code block
- **Edit Mode**: Editable textarea with monospace font

### Custom Component

The `JsonEditor` component (in `components/JsonEditor.tsx`) provides a rich editing experience:

- **Split View**: Side-by-side editor and preview
- **Syntax Highlighting**: Color-coded JSON preview using `react-json-view-lite`
- **Tree View**: Expandable/collapsible JSON structure
- **Live Preview**: Real-time preview as you type
- **Error Handling**: Clear error messages for invalid JSON

## Examples in Config

### Product List

Three different JSON field configurations:

1. **metadata** - Default textarea component
2. **settings** - Custom JsonEditor component
3. **configuration** - Required field with custom editor

### Article List

Demonstrates JSON fields for different use cases:

1. **content** - Rich content structure with custom editor
2. **taxonomy** - Tags/categories with custom user-friendly UI (no JSON editing required)

## Getting Started

### Installation

```bash
pnpm install
```

### Generate Schema and Types

```bash
pnpm generate
```

This generates:

- `prisma/schema.prisma` - Database schema
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - Context factory

### Push to Database

```bash
pnpm db:push
```

Creates SQLite database at `prisma/dev.db`.

### Run Development Server

```bash
pnpm dev
```

Visit [http://localhost:3005/admin](http://localhost:3005/admin)

### Open Prisma Studio

```bash
pnpm db:studio
```

Explore your database visually.

## Usage Patterns

### Basic JSON Field

```typescript
import { json } from '@opensaas/stack-core/fields'

fields: {
  metadata: json({
    validation: { isRequired: false },
    ui: {
      placeholder: 'Enter JSON data...',
      rows: 8,
      formatted: true,
    },
  })
}
```

### Custom Editor Component

```typescript
import { json } from '@opensaas/stack-core/fields'
import { JsonEditor } from './components/JsonEditor'

fields: {
  settings: json({
    validation: { isRequired: false },
    ui: {
      component: JsonEditor, // Override default component
      placeholder: 'Enter settings...',
      rows: 12,
    },
  })
}
```

### Required Field

```typescript
fields: {
  configuration: json({
    validation: { isRequired: true }, // Validation
    ui: {
      component: JsonEditor,
      placeholder: 'Configuration is required...',
    },
  })
}
```

## TaxonomyField Component

The `TaxonomyField` component demonstrates how to create a user-friendly interface for JSON data without requiring users to write JSON manually.

### Features

- **Structured Input**: Users select type (tag/category), enter name and value
- **Visual Display**: Color-coded badges for different types
- **Add/Remove Items**: Simple buttons to manage taxonomy items
- **JSON Storage**: Stores data as JSON array in database automatically
- **Type Safety**: Validates structure of taxonomy items

### Data Structure

```typescript
interface TaxonomyItem {
  type: 'tag' | 'category'
  name: string
  value: string
}
```

Example stored JSON:

```json
[
  { "type": "tag", "name": "author", "value": "john-doe" },
  { "type": "category", "name": "topic", "value": "technology" }
]
```

### Usage Pattern

This demonstrates an important concept: **JSON fields can store structured data while providing intuitive UIs**. Users never see or edit JSON directly - they interact with forms, dropdowns, and buttons.

## Creating Custom JSON Editors

To create your own custom JSON editor component:

### 1. Create Component

```typescript
// components/MyJsonEditor.tsx
'use client'

export interface MyJsonEditorProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  // Add your custom UI options
  customOption?: string
}

export function MyJsonEditor({ value, onChange, ...props }: MyJsonEditorProps) {
  // Convert value to/from JSON
  const handleChange = (text: string) => {
    try {
      const parsed = JSON.parse(text)
      onChange(parsed)
    } catch {
      // Handle error
    }
  }

  return (
    // Your custom UI
  )
}
```

### 2. Use in Config

```typescript
import { MyJsonEditor } from './components/MyJsonEditor'

fields: {
  data: json({
    ui: {
      component: MyJsonEditor,
      customOption: 'value', // Passed as prop
    },
  })
}
```

### Key Considerations

- **Value Type**: The `value` prop is `unknown` - parse/stringify as needed
- **onChange**: Must call `onChange` with parsed JSON object (not string)
- **Error Handling**: Show parse errors without blocking input
- **Modes**: Support both `read` and `edit` modes
- **UI Options**: All `ui` options automatically pass as props

## Library Recommendations

For building custom JSON editors:

- **react-json-view-lite** - Lightweight tree view (used in this example)
- **@monaco-editor/react** - Full-featured Monaco editor with JSON support
- **react-jsonschema-form** - Schema-based form generation
- **json-editor** - Vanilla JS JSON editor (wrapper needed)

## Type Safety

### Default (Unknown)

```typescript
const item = await context.db.product.findUnique({ where: { id } })
const metadata: unknown = item.metadata // TypeScript type
```

### With Type Narrowing

```typescript
interface ProductMetadata {
  brand: string
  tags: string[]
  specs: Record<string, unknown>
}

const metadata = item.metadata as ProductMetadata
// Now you have autocomplete and type checking
```

### With Zod Schema (Recommended)

```typescript
import { z } from 'zod'

const ProductMetadataSchema = z.object({
  brand: z.string(),
  tags: z.array(z.string()),
  specs: z.record(z.unknown()),
})

type ProductMetadata = z.infer<typeof ProductMetadataSchema>

// Validate at runtime
const metadata = ProductMetadataSchema.parse(item.metadata)
```

## Database Behavior

### SQLite

- Stored as TEXT
- Automatically serialized/deserialized by Prisma
- Queryable with JSON functions in raw SQL

### PostgreSQL

- Stored as JSONB
- Supports JSON operators and indexing
- Better performance for JSON queries

### MySQL

- Stored as JSON
- Supports JSON functions
- Validation at database level

## Access Control

JSON fields respect the same access control as other fields:

```typescript
access: {
  field: {
    metadata: {
      read: () => true,
      create: ({ session }) => !!session,
      update: ({ session }) => !!session?.isAdmin,
    }
  }
}
```

## Hooks

Transform JSON data with field-level hooks:

```typescript
fields: {
  metadata: json({
    hooks: {
      // Transform before writing to database
      resolveInput: async ({ inputValue }) => {
        // Add timestamp
        return { ...inputValue, updatedAt: new Date().toISOString() }
      },
      // Transform after reading from database
      resolveOutput: ({ value }) => {
        // Remove internal fields
        const { _internal, ...public } = value as any
        return public
      },
    },
  })
}
```

## Testing

Create a test script to verify JSON field behavior:

```typescript
// test.ts
import { getContext } from './.opensaas/context.js'

async function test() {
  const context = await getContext()

  // Create product with JSON data
  const product = await context.db.product.create({
    data: {
      name: 'Test Product',
      metadata: {
        brand: 'Acme',
        tags: ['electronics', 'new'],
        specs: { weight: '1kg', color: 'blue' },
      },
      settings: {
        notifications: true,
        theme: 'dark',
      },
      configuration: {
        apiKey: 'test-key',
        endpoint: 'https://api.example.com',
      },
    },
  })

  console.log('Created product:', product)

  // Create article with taxonomy data
  const article = await context.db.article.create({
    data: {
      title: 'Getting Started with OpenSaaS',
      content: {
        sections: [
          { type: 'heading', text: 'Introduction' },
          { type: 'paragraph', text: 'Welcome to OpenSaaS Stack...' },
        ],
      },
      taxonomy: [
        { type: 'tag', name: 'author', value: 'john-doe' },
        { type: 'tag', name: 'difficulty', value: 'beginner' },
        { type: 'category', name: 'topic', value: 'tutorials' },
        { type: 'category', name: 'technology', value: 'nextjs' },
      ],
    },
  })

  console.log('Created article:', article)

  // Update JSON field
  const updated = await context.db.product.update({
    where: { id: product.id },
    data: {
      metadata: {
        ...(product.metadata as any),
        tags: ['electronics', 'new', 'featured'],
      },
    },
  })

  console.log('Updated product:', updated)
}

test()
```

Run with:

```bash
npx tsx test.ts
```

## Next Steps

- Explore the admin UI at `/admin`
- Try creating products with different JSON structures
- Customize the JsonEditor component styling
- Add JSON schema validation with Zod
- Implement type-safe JSON field access

## Resources

- [OpenSaaS Stack Documentation](https://github.com/anthropics/opensaas-stack)
- [Prisma JSON Fields](https://www.prisma.io/docs/concepts/components/prisma-schema/data-model#json)
- [react-json-view-lite](https://github.com/AnyRoad/react-json-view-lite)
