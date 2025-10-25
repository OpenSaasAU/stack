# @opensaas/stack-ui

Composable React UI components for OpenSaaS Stack, built with Radix UI and shadcn/ui.

## Installation

```bash
pnpm add @opensaas/stack-ui
```

## Features

- 🎨 **Four Levels of Abstraction** - Primitives, Fields, Standalone Components, Full Admin UI
- ♿ **Accessible** - Built with Radix UI primitives
- 🎯 **Type-Safe** - Full TypeScript support
- 🎨 **Customizable** - Tailwind CSS v4 with CSS variables
- 📦 **Tree-Shakeable** - Import only what you need
- 🧩 **Composable** - Mix and match components

## Package Exports

```typescript
// Primitives (shadcn/ui components)
import { Button, Input, Card, Table, Dialog } from '@opensaas/stack-ui/primitives'

// Field components (OpenSaaS-aware)
import { TextField, SelectField, RelationshipField } from '@opensaas/stack-ui/fields'

// Standalone components (complete features)
import { ItemCreateForm, ListTable, SearchBar } from '@opensaas/stack-ui/standalone'

// Full components (page-level)
import { Dashboard, ListView, ItemForm, AdminUI } from '@opensaas/stack-ui'

// Server utilities
import { getAdminContext } from '@opensaas/stack-ui/server'

// Utility functions
import { cn, formatListName, formatFieldName } from '@opensaas/stack-ui/lib/utils'

// Styles
import '@opensaas/stack-ui/styles'
```

## Architecture

### Level 1: Primitives (`@opensaas/stack-ui/primitives`)

Low-level UI components based on Radix UI and shadcn/ui.

**Available Components:**

- Button - Buttons with variants
- Input - Text inputs
- Label - Form labels
- Card - Content containers
- Table - Data tables
- Dialog - Modal dialogs
- Select - Dropdown selects
- Checkbox - Checkboxes

**Example:**

```tsx
import { Button, Card, CardHeader, CardTitle, CardContent } from '@opensaas/stack-ui/primitives'
;<Card>
  <CardHeader>
    <CardTitle>Welcome</CardTitle>
  </CardHeader>
  <CardContent>
    <Button>Get Started</Button>
  </CardContent>
</Card>
```

### Level 2: Fields (`@opensaas/stack-ui/fields`)

OpenSaaS-aware form fields with validation and access control.

**Available Fields:**

- TextField
- IntegerField
- CheckboxField
- SelectField
- PasswordField
- TimestampField
- RelationshipField

**Example:**

```tsx
import { TextField, SelectField } from '@opensaas/stack-ui/fields'
;<form>
  <TextField name="email" label="Email" value={email} onChange={setEmail} required />
  <SelectField
    name="role"
    label="Role"
    value={role}
    onChange={setRole}
    options={[
      { label: 'Admin', value: 'admin' },
      { label: 'User', value: 'user' },
    ]}
  />
</form>
```

### Level 3: Standalone Components (`@opensaas/stack-ui/standalone`)

Complete, reusable components for common admin tasks.

**Available Components:**

#### ItemCreateForm

```tsx
import { ItemCreateForm } from '@opensaas/stack-ui/standalone'
;<ItemCreateForm
  fields={config.lists.Post.fields}
  onSubmit={async (data) => {
    const post = await createPost(data)
    return { success: !!post }
  }}
  onCancel={() => router.back()}
/>
```

#### ItemEditForm

```tsx
import { ItemEditForm } from '@opensaas/stack-ui/standalone'
;<ItemEditForm
  fields={config.lists.Post.fields}
  initialData={post}
  onSubmit={async (data) => {
    const updated = await updatePost(post.id, data)
    return { success: !!updated }
  }}
/>
```

#### ListTable

```tsx
import { ListTable } from '@opensaas/stack-ui/standalone'
;<ListTable
  items={posts}
  fieldTypes={{ title: 'text', status: 'select' }}
  columns={['title', 'status']}
  onRowClick={(post) => router.push(`/posts/${post.id}`)}
  sortable
/>
```

#### SearchBar

```tsx
import { SearchBar } from '@opensaas/stack-ui/standalone'
;<SearchBar onSearch={(query) => fetchPosts({ search: query })} placeholder="Search posts..." />
```

#### DeleteButton

```tsx
import { DeleteButton } from '@opensaas/stack-ui/standalone'
;<DeleteButton
  onDelete={async () => {
    await deletePost(postId)
    return { success: true }
  }}
  itemName="post"
/>
```

### Level 4: Full Admin UI (`@opensaas/stack-ui`)

Complete admin interface with routing and navigation.

```tsx
import { AdminUI } from '@opensaas/stack-ui'
;<AdminUI
  context={context}
  params={params?.admin}
  searchParams={searchParams}
  basePath="/admin"
  serverAction={handleServerAction}
/>
```

## Component Registry

Extend or override field components:

```tsx
import { registerFieldComponent } from '@opensaas/stack-ui'
import { ColorPickerField } from './components/ColorPickerField'

// Register globally
registerFieldComponent('color', ColorPickerField)

// Use in config
fields: {
  themeColor: text({
    ui: { fieldType: 'color' },
  })
}

// Or override per-field
fields: {
  slug: text({
    ui: { component: SlugField },
  })
}
```

## Theming

All components use Tailwind CSS v4 with CSS variables:

```css
/* app/globals.css */
@import '@opensaas/stack-ui/styles';

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
}

.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  /* ... */
}
```

## Accessibility

All components follow WAI-ARIA guidelines:

- Proper semantic HTML
- ARIA attributes
- Keyboard navigation
- Focus management
- Screen reader support

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  FieldComponent,
  FieldComponentProps,
  ItemCreateFormProps,
  ListTableProps,
  AdminUIProps,
} from '@opensaas/stack-ui'
```

## Examples

- [Blog Example](../../examples/blog) - Basic usage with full AdminUI
- [Custom Field Example](../../examples/custom-field) - Custom field components
- [Composable Dashboard](../../examples/composable-dashboard) - Using standalone components

## Learn More

- [Composability Guide](../../docs/COMPOSABILITY.md) - Complete guide to all four levels
- [API Reference](../../docs/API.md) - Full API documentation
- [OpenSaaS Stack](../../README.md) - Stack overview

## License

MIT
