# OpenSaas UI Composability Guide

OpenSaas provides a fully composable UI layer with four levels of abstraction. Choose the level that best fits your use case - from low-level primitives to a complete admin interface.

## The Four Levels

```
Level 4: AdminUI ──────────────┐  (Complete admin interface)
                               │
Level 3: Standalone ───────────┤  (ItemCreateForm, ListTable, SearchBar)
                               │
Level 2: Fields ───────────────┤  (TextField, SelectField, RelationshipField)
                               │
Level 1: Primitives ───────────┘  (Button, Input, Card, Table, Dialog)
```

Each level builds on the one below, providing progressively higher-level abstractions.

## Level 1: Primitives

**What:** Low-level UI components based on Radix UI and shadcn/ui
**When to use:** Building completely custom UIs with full control
**Import from:** `@opensaas/stack-ui/primitives`

### Available Primitives

- **Button** - Buttons with variants (default, destructive, outline, secondary, ghost, link)
- **Input** - Text inputs with validation states
- **Label** - Accessible form labels
- **Card** - Content containers (Card, CardHeader, CardTitle, CardContent, CardFooter)
- **Table** - Data tables (Table, TableHeader, TableBody, TableRow, TableHead, TableCell)
- **Dialog** - Modal dialogs (Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter)
- **Select** - Dropdown selects with search
- **Checkbox** - Checkboxes with indeterminate state

### Example: Custom Login Form

```tsx
import { Button } from '@opensaas/stack-ui/primitives/button'
import { Input } from '@opensaas/stack-ui/primitives/input'
import { Label } from '@opensaas/stack-ui/primitives/label'
import { Card, CardContent, CardHeader, CardTitle } from '@opensaas/stack-ui/primitives/card'

export function LoginForm() {
  return (
    <Card className="w-[400px]">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@example.com" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" />
          </div>
          <Button type="submit" className="w-full">
            Sign In
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

## Level 2: Field Components

**What:** OpenSaas-aware form fields with validation and field-level access control
**When to use:** Building custom forms that integrate with OpenSaas field configs
**Import from:** `@opensaas/stack-ui/fields`

### Available Fields

- **TextField** - Text inputs
- **IntegerField** - Number inputs
- **CheckboxField** - Boolean checkboxes
- **SelectField** - Select dropdowns
- **PasswordField** - Password inputs with confirmation
- **TimestampField** - Date/time pickers
- **RelationshipField** - Foreign key selects

### Example: Custom Checkout Form

```tsx
import { TextField, SelectField } from '@opensaas/stack-ui/fields'
import { Button } from '@opensaas/stack-ui/primitives'

export function CheckoutForm() {
  const [email, setEmail] = useState('')
  const [plan, setPlan] = useState('')

  const plans = [
    { label: 'Starter - $10/mo', value: 'starter' },
    { label: 'Pro - $25/mo', value: 'pro' },
    { label: 'Enterprise - $99/mo', value: 'enterprise' },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <TextField
        name="email"
        label="Email Address"
        value={email}
        onChange={setEmail}
        required
        mode="edit"
      />

      <SelectField
        name="plan"
        label="Select Plan"
        value={plan}
        onChange={setPlan}
        options={plans}
        required
        mode="edit"
      />

      <Button type="submit">Subscribe Now</Button>
    </form>
  )
}
```

### Field Props Interface

All field components share a common interface:

```typescript
interface FieldProps {
  name: string // Field name
  value: any // Current value
  onChange: (value: any) => void // Change handler
  label: string // Display label
  error?: string // Validation error
  disabled?: boolean // Disabled state
  required?: boolean // Required indicator
  mode?: 'read' | 'edit' // Display mode
}
```

## Level 3: Standalone Components

**What:** Complete, reusable components for common admin tasks
**When to use:** Embedding admin functionality in custom pages
**Import from:** `@opensaas/stack-ui/standalone`

### Available Components

#### ItemCreateForm

Standalone form for creating items with custom submission handling.

```tsx
import { ItemCreateForm } from '@opensaas/stack-ui/standalone'
import config from '../opensaas.config'

export function CreatePostPage() {
  const router = useRouter()

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Create New Post</h1>

      <ItemCreateForm
        fields={config.lists.Post.fields}
        onSubmit={async (data) => {
          try {
            const post = await createPost(data)
            toast.success(`Created "${post.title}"`)
            router.push(`/posts/${post.id}`)
            return { success: true }
          } catch (error) {
            return { success: false, error: error.message }
          }
        }}
        onCancel={() => router.back()}
        submitLabel="Publish Post"
      />
    </div>
  )
}
```

**Props:**

```typescript
interface ItemCreateFormProps {
  fields: Record<string, FieldConfig>
  onSubmit: (data: Record<string, any>) => Promise<{ success: boolean; error?: string }>
  onCancel?: () => void
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  submitLabel?: string
  cancelLabel?: string
  className?: string
}
```

#### ItemEditForm

Standalone form for editing existing items.

```tsx
import { ItemEditForm } from '@opensaas/stack-ui/standalone'

export function EditPostPage({ post }) {
  return (
    <ItemEditForm
      fields={config.lists.Post.fields}
      initialData={post}
      onSubmit={async (data) => {
        const updated = await updatePost(post.id, data)
        return { success: !!updated }
      }}
      onCancel={() => router.push(`/posts/${post.id}`)}
    />
  )
}
```

#### ListTable

Standalone table for displaying lists with sorting and actions.

```tsx
import { ListTable } from '@opensaas/stack-ui/standalone'

export function RecentPosts({ posts }) {
  return (
    <ListTable
      items={posts}
      fieldTypes={{
        title: 'text',
        author: 'relationship',
        publishedAt: 'timestamp',
        status: 'select',
      }}
      columns={['title', 'author', 'publishedAt', 'status']}
      onRowClick={(post) => router.push(`/posts/${post.id}`)}
      renderActions={(post) => (
        <DeleteButton
          onDelete={async () => {
            await deletePost(post.id)
            return { success: true }
          }}
        />
      )}
      sortable
    />
  )
}
```

#### SearchBar

Reusable search component with clear functionality.

```tsx
import { SearchBar } from '@opensaas/stack-ui/standalone'

export function PostsPage() {
  const [search, setSearch] = useState('')

  return (
    <div>
      <SearchBar
        onSearch={(query) => {
          setSearch(query)
          fetchPosts({ search: query })
        }}
        onClear={() => {
          setSearch('')
          fetchPosts({})
        }}
        placeholder="Search posts..."
        defaultValue={search}
      />
    </div>
  )
}
```

#### DeleteButton

Delete button with built-in confirmation dialog.

```tsx
import { DeleteButton } from '@opensaas/stack-ui/standalone'

export function PostActions({ postId }) {
  return (
    <DeleteButton
      onDelete={async () => {
        await deletePost(postId)
        router.push('/posts')
        return { success: true }
      }}
      itemName="post"
      confirmMessage="This will permanently delete the post and all its comments."
      buttonVariant="destructive"
    />
  )
}
```

## Level 4: Full Admin UI

**What:** Complete admin interface with routing, navigation, and CRUD operations
**When to use:** When you need a full-featured admin panel out of the box
**Import from:** `@opensaas/stack-ui`

### Example: Complete Admin Route

```tsx
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getAdminContext } from '@opensaas/stack-ui/server'
import config from '@/opensaas.config'

export default async function AdminPage({ params, searchParams }) {
  const context = await getAdminContext(config, prisma, session)

  return (
    <AdminUI
      context={context}
      params={params?.admin}
      searchParams={searchParams}
      basePath="/admin"
      serverAction={handleServerAction}
    />
  )
}
```

This provides:

- Dashboard with list cards
- List views with search and pagination
- Create/edit forms
- Delete confirmations
- Navigation sidebar
- Field-level access control
- Relationship handling

## Real-World Use Cases

### Use Case 1: Multi-Step Wizard

Combine standalone components for complex workflows:

```tsx
export function OnboardingWizard() {
  const [step, setStep] = useState(1)
  const [userId, setUserId] = useState('')

  return (
    <div className="max-w-2xl mx-auto">
      {step === 1 && (
        <ItemCreateForm
          fields={config.lists.User.fields}
          onSubmit={async (data) => {
            const user = await createUser(data)
            setUserId(user.id)
            setStep(2)
            return { success: true }
          }}
          submitLabel="Next: Choose Plan"
        />
      )}

      {step === 2 && (
        <ItemCreateForm
          fields={config.lists.Subscription.fields}
          initialData={{ userId }}
          onSubmit={async (data) => {
            await createSubscription(data)
            router.push('/dashboard')
            return { success: true }
          }}
          submitLabel="Complete Setup"
        />
      )}
    </div>
  )
}
```

### Use Case 2: Custom Dashboard

Build a custom dashboard using primitives and standalone components:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@opensaas/stack-ui/primitives'
import { ListTable, SearchBar } from '@opensaas/stack-ui/standalone'
import { ItemCreateForm } from '@opensaas/stack-ui/standalone'
import { Dialog, DialogContent } from '@opensaas/stack-ui/primitives'

export function CustomDashboard() {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="p-8">
      <div className="grid grid-cols-3 gap-6">
        {/* Stats Cards */}
        <Card>
          <CardHeader>
            <CardTitle>Total Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{stats.posts}</p>
          </CardContent>
        </Card>

        {/* Recent Posts */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Recent Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <SearchBar onSearch={handleSearch} />
            <ListTable
              items={recentPosts}
              fieldTypes={{ title: 'text', createdAt: 'timestamp' }}
              onRowClick={(post) => router.push(`/posts/${post.id}`)}
            />
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <ItemCreateForm
            fields={config.lists.Post.fields}
            onSubmit={async (data) => {
              await createPost(data)
              setShowCreate(false)
              return { success: true }
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

### Use Case 3: Inline Editing

Toggle between view and edit modes:

```tsx
export function PostDetailPage({ post }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ItemEditForm
        fields={config.lists.Post.fields}
        initialData={post}
        onSubmit={async (data) => {
          await updatePost(post.id, data)
          setEditing(false)
          return { success: true }
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
      <Button onClick={() => setEditing(true)}>Edit</Button>
    </div>
  )
}
```

## Choosing the Right Level

| Use Case             | Recommended Level    | Why                          |
| -------------------- | -------------------- | ---------------------------- |
| Complete admin panel | Level 4 (AdminUI)    | Out-of-the-box functionality |
| Custom dashboard     | Level 3 (Standalone) | Compose admin features       |
| Checkout flow        | Level 2 (Fields)     | Custom form layout           |
| Login page           | Level 1 (Primitives) | Full design control          |
| Multi-step wizard    | Level 3 (Standalone) | Reuse form logic             |
| Embedded forms       | Level 3 (Standalone) | Drop-in components           |

## Styling and Theming

All components use Tailwind CSS v4 with CSS variables matching the shadcn/ui color system:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  /* ... */
}
```

Override colors in your `globals.css`:

```css
:root {
  --primary: 221.2 83.2% 53.3%; /* Custom blue */
  --destructive: 0 84.2% 60.2%; /* Custom red */
}
```

## Accessibility

All primitives are built with Radix UI, providing:

- ARIA attributes
- Keyboard navigation
- Focus management
- Screen reader support
- Proper semantic HTML

## Next Steps

- See the [API Reference](/docs/api-reference) for complete prop documentation
- Explore the composable dashboard example for working code
- Read the Custom Field Guide for extending field types
- Check out the [GitHub repository](https://github.com/OpenSaasAU/stack) for more examples
