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

Type-only re-exports for wiring the admin's server action (no runtime exports):

- `ServerActionInput` - Props passed to the generic server action (re-exported from stack-core)
- `ActionResult<T>` - Result shape returned by a server action

The host app builds the access-scoped `context` itself (from the generated
`.opensaas/context`) and passes it to `AdminUI`. There is no `getAdminContext`
helper in this package.

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
    customOption: 'value',
  },
})

// Component receives all ui options as props
export function RichTextField({ placeholder, minHeight, customOption, ...baseProps }) {
  // Use options
}
```

`FieldRenderer` extracts `component` and `fieldType`, passes rest as props.

### Server/Client Boundaries

- `AdminUI` is a server component (the host builds and passes `context`)
- Forms and interactive components are client components
- Data serialization via props (no functions, only JSON-serializable data)

## Integration Points

### With @opensaas/stack-core

- Reads config to generate UI
- Uses context for all data operations
- Field components map to field types via registry

### With @opensaas/stack-auth

- The host resolves the Better-auth session and passes it to `getContext(session)`
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

The host builds the access-scoped `context` (and `config`) from the generated
`.opensaas/context` and wires a `'use server'` action that forwards to
`context.serverAction`:

```typescript
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

With auth, resolve the session and pass it to `getContext(session)` (in both the
page and the wrapper). See `examples/starter`, `examples/starter-auth`, and
`examples/auth-demo`.

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

## Dark mode / color scheme

The token sheet defines every color once with `light-dark()`, driven by
`color-scheme`. A `data-theme="light" | "dark"` attribute on the document root
pins the scheme (overriding the OS preference); its absence follows the system
preference. This is the whole mechanism — no duplicated `.dark` block.

Two pieces make it user-controllable:

- **`ThemeToggle`** — a `'use client'` control that cycles light → dark →
  system, writes `data-theme` on `<html>`, persists the choice to
  `localStorage` (`opensaas-theme`), and restores it on mount. It ships in the
  default Admin chrome's user menu (footer). It is composable: custom chrome
  that builds its own `Navigation`/`UserMenu` simply omits it, or the exported
  `ThemeToggle` can be placed anywhere.
- **`ThemeScript`** — a server-safe inline `<script>` for the document `<head>`
  that applies the saved choice **before first paint**, preventing a flash of
  the wrong scheme before hydration. Add it once in your root layout:

  ```tsx
  import { ThemeScript } from '@opensaas/stack-ui'

  export default function RootLayout({ children }) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  `suppressHydrationWarning` is needed because the script mutates `data-theme`
  before React hydrates.

  **Strict-CSP apps:** a nonce-based `script-src` policy blocks inline scripts
  unless they carry a matching `nonce`. Pass the per-request nonce (the same one
  your middleware/CSP emits) so the flash-prevention script survives the policy:

  ```tsx
  import { headers } from 'next/headers'
  import { ThemeScript } from '@opensaas/stack-ui'

  export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-nonce') ?? undefined
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript nonce={nonce} />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  `nonce` is optional: omit it and the output is byte-identical to before (no
  `nonce` attribute emitted). The value is forwarded only to the `<script>`'s
  `nonce` attribute — it is never interpolated into the script body.

### Pinning the admin to a single scheme

To lock the admin to light-only or dark-only (matching a product with a fixed
appearance), **omit `ThemeToggle` and `ThemeScript`** and set the attribute
statically in your root layout:

```tsx
// Dark-only admin — no toggle, no localStorage.
<html lang="en" data-theme="dark">
  <body>{children}</body>
</html>
```

Because `data-theme` overrides the OS preference, the admin then renders in that
scheme regardless of the visitor's system setting. Lower-level helpers
(`applyThemeChoice`, `readStoredChoice`, `themeInitScript`, `THEME_STORAGE_KEY`,
and the `ThemeChoice` type) are also exported for custom toggles.

## Type Safety

All components are fully typed:

- Context types inferred from Prisma client
- Field props typed based on field config
- Form data validated with react-hook-form + Zod

Avoid `any` types - all props are strongly typed for type safety.

## Performance

- Server components by default (AdminUI renders on the server)
- Client components marked with `'use client'`
- Minimal client-side JS for interactive features only
- Data fetching on server reduces client bundle size
