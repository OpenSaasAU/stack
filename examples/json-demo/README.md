# OpenSaaS JSON Field Demo

This example demonstrates the JSON field type in OpenSaaS Stack, showing both the default textarea component and a custom rich JSON editor component.

## Features

### JSON Field Type

The `json()` field builder stores arbitrary JSON data in the database:

- **Type**: A Postgres `jsonb` column
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

### Set Up Environment

```bash
cp .env.example .env
```

### Generate Schema and Types

```bash
pnpm generate
```

This generates:

- `prisma/contract.ts` - the Contract module, and its emitted `contract.json` / `contract.d.ts`
- `prisma.config.ts` - the Prisma CLI configuration
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - Context factory

### Run Development Server

```bash
pnpm dev
```

Visit [http://localhost:3005/admin](http://localhost:3005/admin)

### Browse the data

Prisma 8 ships no Studio, so browse the data with any Postgres client
pointed at the connection string `pnpm dev` prints on startup (or at your
own `DATABASE_URL`):

```bash
psql "$DATABASE_URL"
```

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
const item = await context.db.Product.where({ id: { equals: id } }).first()
if (!item) return // `null` is not-found or denied
const metadata: unknown = item.metadata // TypeScript type
```

### With Zod Schema (Recommended)

A cast would only silence the compiler — the value came from the database and
nothing has checked its shape. Parse it instead, and the narrowed type is
earned rather than asserted:

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

The database is Postgres, and only Postgres. A `json()` field is a `jsonb`
column: it supports Postgres' JSON operators and indexing, and round-trips
objects, arrays and scalars without a serialization step of your own.

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
        if (typeof value !== 'object' || value === null) return value
        const { _internal, ...rest } = value
        return rest
      },
    },
  })
}
```

## Testing

`tests/json-round-trip.test.ts` proves the round-trip: it stands up a real
Dev database with `createTestContext` from `@opensaas/stack-core/testing`,
writes nested objects and top-level arrays through the secured context, and
reads them back. No database of your own is needed.

```bash
pnpm test
```

## Next Steps

- Explore the admin UI at `/admin`
- Try creating products with different JSON structures
- Customize the JsonEditor component styling
- Add JSON schema validation with Zod
- Implement type-safe JSON field access

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [OpenSaaS Stack on GitHub](https://github.com/OpenSaasAU/stack)
- [react-json-view-lite](https://github.com/AnyRoad/react-json-view-lite)
