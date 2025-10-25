# Phase 5: Migrate UI Package to shadcn/ui with Full Composability

## Current State Analysis

### ✅ What we have:

- Full admin UI implementation with 10+ components (Dashboard, ListView, ItemForm, Navigation, etc.)
- Field component registry pattern for extensibility
- Custom-built form inputs using plain Tailwind CSS
- Tailwind v4 with CSS variables for theming (already shadcn-compatible!)
- Working components: ConfirmDialog, LoadingSpinner, SkeletonLoader, etc.

### ❌ What's missing:

- Polished, production-ready UI components (buttons, inputs, dialogs)
- **Composable exports for custom pages**
- **Standalone field components for custom forms**
- Accessibility features (ARIA, keyboard navigation)
- Advanced components (Popover, Dropdown, Combobox, etc.)

## Proposed Migration to shadcn/ui + Composability

### Why shadcn/ui is perfect:

1. **Not a dependency** - copies components into your codebase (fits our philosophy)
2. **Tailwind CSS based** - already using Tailwind v4
3. **Customizable** - components are yours to modify
4. **Accessible** - built with Radix UI primitives
5. **Our color system already matches** - using same HSL CSS variable pattern!

## Implementation Plan

### 1. Add shadcn/ui Base Components (`primitives/`)

Create `packages/ui/src/primitives/` for core shadcn components:

- **Button** - Replace custom button styling
- **Input** - Enhance form inputs
- **Label** - Accessible form labels
- **Dialog** - Replace ConfirmDialog
- **Table** - Enhance ListView tables
- **Card** - For Dashboard cards
- **Select** - For SelectField
- **Checkbox** - For CheckboxField
- **Form** (react-hook-form integration) - Already using it!

### 2. Create Composable Field Components

Make field components **standalone and reusable**:

```tsx
// Current: Only works inside ItemForm
import { ItemForm } from '@opensaas/stack-ui'

// NEW: Composable fields for custom forms
import { TextField, SelectField, Form } from '@opensaas/stack-ui/fields'

// Developer can build custom forms
function CustomCheckoutForm() {
  return (
    <Form>
      <TextField name="email" label="Email" />
      <SelectField name="plan" label="Plan" options={plans} />
      <Button type="submit">Subscribe</Button>
    </Form>
  )
}
```

### 3. Export Composable Page Sections

Break down monolithic components into composable pieces:

**Current:**

```tsx
// Only option: Use entire admin UI
<AdminUI context={context} />
```

**NEW: Composable exports**

```tsx
// Option 1: Full admin UI (existing)
import { AdminUI } from '@opensaas/stack-ui'
;<AdminUI context={context} />

// Option 2: Individual page components
import { Dashboard, ListView, ItemDetail, ItemCreateForm } from '@opensaas/stack-ui'
;<Dashboard context={context} />

// Option 3: Embed components in custom pages
import { ItemCreateForm } from '@opensaas/stack-ui'
function CustomPage() {
  return (
    <div>
      <h1>Create New Post</h1>
      <p>Fill out the form below...</p>
      <ItemCreateForm
        listKey="Post"
        context={context}
        onSuccess={(item) => router.push(`/posts/${item.id}`)}
      />
    </div>
  )
}

// Option 4: Use primitives directly
import { Button, Input, Card } from '@opensaas/stack-ui/primitives'
;<Card>
  <Input placeholder="Search..." />
  <Button>Submit</Button>
</Card>
```

### 4. Enhanced Package Exports

**New package.json exports:**

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./primitives": {
      "types": "./dist/primitives/index.d.ts",
      "default": "./dist/primitives/index.js"
    },
    "./fields": {
      "types": "./dist/components/fields/index.d.ts",
      "default": "./dist/components/fields/index.js"
    },
    "./server": {
      "types": "./dist/server/index.d.ts",
      "default": "./dist/server/index.js"
    },
    "./styles": "./dist/styles/globals.css"
  }
}
```

**Usage patterns:**

```tsx
// Primitives (shadcn components)
import { Button, Input, Dialog } from '@opensaas/stack-ui/primitives'

// Field components (OpenSaaS-aware)
import { TextField, RelationshipField } from '@opensaas/stack-ui/fields'

// Full page components
import { Dashboard, ListView, ItemForm } from '@opensaas/stack-ui'

// Complete admin UI
import { AdminUI } from '@opensaas/stack-ui'

// Server utilities
import { getAdminContext } from '@opensaas/stack-ui/server'
```

### 5. New Composable Components

#### ItemCreateForm (Standalone)

```tsx
export interface ItemCreateFormProps {
  listKey: string
  context: AdminContext
  onSuccess?: (item: any) => void
  onCancel?: () => void
  redirectOnSuccess?: string
  submitLabel?: string
}

// Usage in custom page
;<ItemCreateForm
  listKey="Post"
  context={context}
  onSuccess={(post) => {
    toast.success(`Created ${post.title}`)
    router.push(`/posts/${post.id}`)
  }}
/>
```

#### ItemEditForm (Standalone)

```tsx
<ItemEditForm
  listKey="Post"
  itemId="123"
  context={context}
  fields={['title', 'content', 'status']} // Optional: limit fields
/>
```

#### ListTable (Standalone)

```tsx
<ListTable
  listKey="Post"
  context={context}
  columns={['title', 'author', 'createdAt']}
  onRowClick={(item) => router.push(`/posts/${item.id}`)}
  filters={{ status: 'published' }}
/>
```

#### FieldGroup (Custom field layouts)

```tsx
import { FieldGroup, TextField, SelectField } from '@opensaas/stack-ui/fields'
;<FieldGroup>
  <div className="grid grid-cols-2 gap-4">
    <TextField name="firstName" label="First Name" />
    <TextField name="lastName" label="Last Name" />
  </div>
  <SelectField name="country" label="Country" options={countries} />
</FieldGroup>
```

## Real-World Use Cases

### Use Case 1: Multi-Model Form

```tsx
// Checkout form that creates User + Subscription
function CheckoutPage() {
  const [step, setStep] = useState(1)

  return (
    <div>
      {step === 1 && (
        <ItemCreateForm
          listKey="User"
          onSuccess={(user) => {
            setUserId(user.id)
            setStep(2)
          }}
        />
      )}
      {step === 2 && (
        <ItemCreateForm
          listKey="Subscription"
          initialData={{ userId }}
          onSuccess={() => router.push('/dashboard')}
        />
      )}
    </div>
  )
}
```

### Use Case 2: Custom Dashboard

```tsx
function MyDashboard() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <Card>
        <h2>Recent Posts</h2>
        <ListTable listKey="Post" limit={5} columns={['title', 'createdAt']} />
      </Card>

      <Card>
        <h2>Quick Actions</h2>
        <Button onClick={() => setShowCreate(true)}>Create Post</Button>
      </Card>

      {showCreate && (
        <Dialog open onClose={() => setShowCreate(false)}>
          <ItemCreateForm listKey="Post" onSuccess={() => setShowCreate(false)} />
        </Dialog>
      )}
    </div>
  )
}
```

### Use Case 3: Inline Editing

```tsx
function PostDetailPage({ id }) {
  const [editing, setEditing] = useState(false)

  return (
    <div>
      {!editing ? (
        <div>
          <ItemDetail listKey="Post" itemId={id} />
          <Button onClick={() => setEditing(true)}>Edit</Button>
        </div>
      ) : (
        <ItemEditForm
          listKey="Post"
          itemId={id}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}
```

## File Structure

```
packages/ui/
├── src/
│   ├── primitives/              # shadcn/ui components (NEW)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── dialog.tsx
│   │   ├── table.tsx
│   │   ├── card.tsx
│   │   ├── select.tsx
│   │   └── index.ts            # Export all primitives
│   │
│   ├── components/
│   │   ├── fields/              # Standalone field components (ENHANCED)
│   │   │   ├── TextField.tsx   # Now composable
│   │   │   ├── SelectField.tsx
│   │   │   ├── FieldGroup.tsx  # NEW: Field layout wrapper
│   │   │   └── index.ts        # Export for @opensaas/stack-ui/fields
│   │   │
│   │   ├── ItemCreateForm.tsx  # NEW: Standalone create form
│   │   ├── ItemEditForm.tsx    # NEW: Standalone edit form
│   │   ├── ItemDetail.tsx      # NEW: Standalone detail view
│   │   ├── ListTable.tsx       # NEW: Standalone table
│   │   ├── Dashboard.tsx       # Enhanced with Card primitives
│   │   ├── ListView.tsx        # Enhanced with Table primitives
│   │   ├── ItemForm.tsx        # Now uses composable fields
│   │   └── AdminUI.tsx         # Full admin UI (orchestrator)
│   │
│   ├── lib/
│   │   └── utils.ts
│   │
│   ├── server/
│   │   └── index.ts
│   │
│   └── index.ts                # Main exports
│
└── package.json                # Enhanced exports
```

## Benefits

1. **Full Composability**: Developers can use any level of abstraction
2. **Custom Workflows**: Build checkout flows, wizards, multi-step forms
3. **Embedded Forms**: Drop ItemCreateForm anywhere in their app
4. **Primitives Access**: Build custom UIs with shadcn components
5. **Progressive Enhancement**: Start with AdminUI, customize as needed
6. **Better UX**: Professional, accessible components
7. **Flexibility**: Override any component at any level

## Migration Strategy

### Phase 1 - Add Primitives (No Breaking Changes)

- Add shadcn components to `primitives/`
- Export via `@opensaas/stack-ui/primitives`
- Update internal components to use primitives

### Phase 2 - Make Fields Composable

- Enhance field components to work standalone
- Export via `@opensaas/stack-ui/fields`
- Add FieldGroup wrapper

### Phase 3 - Extract Standalone Components

- Create ItemCreateForm, ItemEditForm, ListTable
- Add success/cancel callbacks
- Export from main package

### Phase 4 - Documentation & Examples

- Add example: Custom checkout flow
- Add example: Embedded forms
- Add example: Custom dashboard

## Estimated Impact

- **Lines added**: ~1,500 (primitives + standalone components)
- **Components added**: ~15 shadcn primitives + 5 standalone components
- **Breaking changes**: NONE (purely additive)
- **Bundle size**: +25-35KB (only what you import)
- **Development time**: 6-8 hours for complete implementation

## Dependencies to Add

```json
{
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.2",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-popover": "^1.1.2",
    "@radix-ui/react-select": "^2.1.2",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.1",
    "@radix-ui/react-toast": "^1.2.2",
    "class-variance-authority": "^0.7.1"
  }
}
```

## Success Metrics

- ✅ All existing examples continue to work (AdminUI unchanged)
- ✅ New examples demonstrate composable usage
- ✅ Field components work standalone
- ✅ Primitives are accessible and documented
- ✅ Bundle size increase < 40KB
- ✅ No breaking changes to existing API
