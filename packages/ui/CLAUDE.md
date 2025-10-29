# @opensaas/stack-ui

Composable React UI components for OpenSaas Stack admin interfaces, built on shadcn/ui primitives.

## Purpose

Provides multiple levels of UI abstraction:
1. **Full AdminUI** - Complete admin interface with routing
2. **Standalone Components** - Drop-in CRUD components (forms, tables)
3. **Field Components** - Individual field inputs
4. **Primitives** - Low-level shadcn/ui components for custom UIs

## Key Exports

### Main Export (`src/index.ts`)
- `AdminUI` - Complete admin interface
- `registerFieldComponent(type, Component)` - Register custom field components
- Primitives re-exported

### Primitives (`/primitives`)
shadcn/ui components:
- `Button`, `Input`, `Label`, `Checkbox`, `Select`
- `Card`, `CardHeader`, `CardContent`, `CardFooter`
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`
- `Popover`, `Calendar`, `DatetimePicker`, `TimePicker`
- `Combobox` - Search and select component

### Fields (`/fields`)
Field components for forms:
- `TextField`, `IntegerField`, `CheckboxField`, `TimestampField`
- `PasswordField`, `SelectField`, `RelationshipField`
- `FieldRenderer` - Renders field based on config (uses registry)

### Standalone (`/standalone`)
Composable CRUD components:
- `ItemCreateForm` - Create new item
- `ItemEditForm` - Edit existing item
- `ListTable` - Display list of items
- `SearchBar` - Search and filter
- `DeleteButton` - Delete with confirmation

### Server (`/server`)
- `getAdminContext(headers)` - Get context with session from request headers

## Architecture Patterns

### Component Registry
Field components are registered by type, avoiding switch statements:
```typescript
// Default registry
registerFieldComponent('text', TextField)
registerFieldComponent('integer', IntegerField)
// etc.

// Custom registration
registerFieldComponent('color', ColorPickerField)
```

### Component Resolution Priority
`FieldRenderer` resolves components in order:
1. `field.ui.component` - Per-field override (highest priority)
2. `field.ui.fieldType` - Custom type lookup in registry
3. `field.type` - Default type lookup in registry

### Composability Levels

**Level 1: Full AdminUI**
```typescript
import { AdminUI } from '@opensaas/stack-ui'
<AdminUI context={context} config={config} />
```

**Level 2: Standalone Components**
```typescript
import { ItemCreateForm, ListTable } from '@opensaas/stack-ui/standalone'

<ItemCreateForm
  listKey="Post"
  context={context}
  onSuccess={(item) => router.push(`/posts/${item.id}`)}
/>

<ListTable
  listKey="Post"
  context={context}
  columns={['title', 'author', 'createdAt']}
/>
```

**Level 3: Field Components**
```typescript
import { TextField, SelectField } from '@opensaas/stack-ui/fields'

<form>
  <TextField
    name="title"
    value={title}
    onChange={setTitle}
    label="Title"
    required
  />
</form>
```

**Level 4: Primitives**
```typescript
import { Button, Card, Input } from '@opensaas/stack-ui/primitives'

<Card>
  <Input placeholder="Custom input" />
  <Button onClick={handleClick}>Submit</Button>
</Card>
```

### UI Options Pass-Through
Field config `ui` options automatically pass to components:
```typescript
// Config
content: richText({
  ui: {
    placeholder: 'Write content...',
    minHeight: 300,
    customOption: 'value'
  }
})

// Component receives all ui options as props
export function RichTextField({ placeholder, minHeight, customOption, ...baseProps }) {
  // Use options
}
```

`FieldRenderer` extracts `component` and `fieldType`, passes rest as props.

### Server/Client Boundaries
- `AdminUI` is server component (uses `getAdminContext`)
- Forms and interactive components are client components
- Data serialization via props (no functions, only JSON-serializable data)

## Integration Points

### With @opensaas/stack-core
- Reads config to generate UI
- Uses context for all data operations
- Field components map to field types via registry

### With @opensaas/stack-auth
- `getAdminContext` uses Better-auth to get session
- Session flows through context to access control
- Auth UI components imported separately from `@opensaas/stack-auth/ui`

### With Third-Party Field Packages
Third-party fields register components on client side:
```typescript
// lib/register-fields.ts
'use client'
import { registerFieldComponent } from '@opensaas/stack-ui'
import { RichTextField } from '@opensaas/stack-tiptap'
registerFieldComponent('richText', RichTextField)

// app/admin/[[...admin]]/page.tsx
import '../../../lib/register-fields' // Side-effect import
```

## Common Patterns

### Basic Admin Setup
```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getAdminContext } from '@opensaas/stack-ui/server'
import config from '@/opensaas.config'

export default async function AdminPage() {
  const context = await getAdminContext()
  return <AdminUI context={context} config={config} />
}
```

### Custom Field Component (Global Registration)
```typescript
// lib/register-fields.ts
'use client'
import { registerFieldComponent } from '@opensaas/stack-ui'
import { ColorPickerField } from './components/ColorPickerField'

registerFieldComponent('color', ColorPickerField)

// opensaas.config.ts
fields: {
  themeColor: text({ ui: { fieldType: 'color' } })
}
```

### Custom Field Component (Per-Field Override)
```typescript
// opensaas.config.ts
import { SlugField } from './components/SlugField'

fields: {
  slug: text({ ui: { component: SlugField } })
}
```

### Composable Dashboard
```typescript
import { ItemCreateForm, ListTable } from '@opensaas/stack-ui/standalone'
import { Card, Button } from '@opensaas/stack-ui/primitives'

export default function CustomDashboard() {
  return (
    <div className="grid gap-4">
      <Card>
        <h2>Recent Posts</h2>
        <ListTable
          listKey="Post"
          context={context}
          columns={['title', 'status', 'createdAt']}
        />
      </Card>

      <Card>
        <h2>Create Post</h2>
        <ItemCreateForm
          listKey="Post"
          context={context}
          onSuccess={(item) => router.push(`/posts/${item.id}`)}
        />
      </Card>
    </div>
  )
}
```

### Standalone Form with Custom Actions
```typescript
import { ItemEditForm } from '@opensaas/stack-ui/standalone'

<ItemEditForm
  listKey="Post"
  itemId={postId}
  context={context}
  onSuccess={(item) => {
    // Custom success handling
    toast.success('Post updated!')
    router.push('/posts')
  }}
  onError={(error) => {
    // Custom error handling
    toast.error(error.message)
  }}
/>
```

## Styling

Package includes Tailwind v4 styles:
```typescript
// app/layout.tsx
import '@opensaas/stack-ui/styles'
```

Custom theming via CSS variables (follows shadcn/ui conventions).

## Type Safety

All components are fully typed:
- Context types inferred from Prisma client
- Field props typed based on field config
- Form data validated with react-hook-form + Zod

Avoid `any` types - all props are strongly typed for type safety.

## Performance

- Server components by default (AdminUI, getAdminContext)
- Client components marked with `'use client'`
- Minimal client-side JS for interactive features only
- Data fetching on server reduces client bundle size
