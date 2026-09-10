# @opensaas/stack-ui

Composable React UI components for OpenSaas Stack, built with Radix UI and shadcn/ui.

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

// Field components (OpenSaas-aware)
import { TextField, SelectField, RelationshipField } from '@opensaas/stack-ui/fields'

// Standalone components (complete features)
import { ItemCreateForm, ListTable, SearchBar } from '@opensaas/stack-ui/standalone'

// Full components (page-level)
import { Dashboard, ListView, ItemForm, AdminUI } from '@opensaas/stack-ui'

// Server utility types
import type { ServerActionInput, ActionResult } from '@opensaas/stack-ui/server'

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
- Badge - Status and category labels
- Avatar - User images with a fallback
- Input - Text inputs
- Textarea - Multi-line text inputs
- Label - Form labels
- Card - Content containers
- Table - Data tables
- Dialog - Modal dialogs
- Select - Dropdown selects
- Checkbox - Checkboxes
- Popover - Anchored overlays
- Calendar - Date picker calendar
- TimePicker - Time-of-day input
- DateTimePicker - Combined date and time input
- Combobox - Searchable select

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

OpenSaas-aware form fields with validation and access control.

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

`config`'s default export is a promise when plugins are present, so a server
component awaits it before reading `lists`:

```tsx
import { ItemCreateForm } from '@opensaas/stack-ui/standalone'
import { config } from '@/.opensaas/context'

const { lists } = await config
;<ItemCreateForm
  fields={lists.Post.fields}
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
import { config } from '@/.opensaas/context'

const { lists } = await config
;<ItemEditForm
  fields={lists.Post.fields}
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

Complete admin interface with routing and navigation. The host app builds the
access-scoped `context` (and `config`) from the generated `.opensaas/context`
and passes them in, along with a `'use server'` wrapper that forwards form
submissions to `context.serverAction`:

```tsx
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'

// User-defined wrapper that runs the server action with an access-scoped context
async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext()
  return await context.serverAction(props)
}

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  return (
    <AdminUI
      context={await getContext()}
      config={await config}
      params={resolvedParams.admin}
      searchParams={resolvedSearchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
```

> With `@opensaas/stack-auth`, resolve the session first and pass it to
> `getContext(session)` (in both the page and the `serverAction` wrapper) so
> access control runs as the signed-in user. See `examples/starter-auth` and
> `examples/auth-demo`.

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

All components use Tailwind CSS v4 and consume one set of named CSS custom
property tokens — `--color-*`, `--font-*`, `--radius*`, `--shadow-*`. Those
names are the compatibility promise; they carry `oklch()` values, not bare HSL
triplets, and there is no `.dark` class. Light and dark are the same tokens
resolved through `light-dark()`, switched by a `data-theme` attribute on
`<html>`.

The usual override path is `ui.theme` in `opensaas.config.ts`:

```typescript
import { config } from '@opensaas/stack-core'

export default config({
  db: { provider: 'postgresql' },
  lists: {},
  ui: {
    theme: {
      preset: 'modern', // 'modern' | 'classic' | 'neon'
      colors: { primary: 'oklch(0.55 0.2 264)' },
      darkColors: { primary: 'oklch(0.62 0.19 264)' },
      radius: 0.5,
    },
  },
})
```

To override from your own stylesheet instead, write the same contract tokens in a
sheet loaded after the package styles — the config layer and the stylesheet
target identical variables, so the two cannot drift. A contract token set this
way applies to both schemes:

```css
/* app/admin-theme.css — imported after '@opensaas/stack-ui/styles' */
:root {
  --color-primary: #6d28d9;
  --color-ring: #6d28d9;
  --radius: 0.375rem;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

See the [Theming guide](https://stack.opensaas.au/docs/how-to/theming) for the
full token vocabulary and the customization ladder.

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

- [Composability Guide](https://stack.opensaas.au/docs/how-to/composability) - Complete guide to all four levels
- [UI Reference](https://stack.opensaas.au/docs/reference/ui) - Full API documentation
- [OpenSaas Stack](../../README.md) - Stack overview

## License

MIT
