# Composable Dashboard Example

This example demonstrates building a custom admin interface using OpenSaaS standalone components instead of the full `AdminUI`. It showcases the composability of the UI layer.

## What This Demonstrates

### Standalone Components Used

1. **ItemCreateForm** - Embedded in a Dialog for inline post creation
2. **ItemEditForm** - Inline editing on post detail page
3. **ListTable** - Display posts and users with sorting
4. **SearchBar** - Search functionality on posts page
5. **DeleteButton** - Delete posts with confirmation

### Primitives Used

- **Card** - Stats cards and content containers
- **Button** - Navigation and actions
- **Dialog** - Modal for creating posts
- **Table** components (via ListTable)

### Key Features

- **Custom Dashboard** - Stats cards with post counts
- **Posts Management** - List, search, create, edit, delete
- **Users List** - Simple user listing with post counts
- **No AdminUI** - Completely custom layout and navigation
- **API Routes** - Next.js API routes instead of Server Actions

## Architecture

### Pages Structure

```
app/
├── page.tsx              # Custom dashboard with stats
├── posts/
│   ├── page.tsx         # Posts list with ListTable + SearchBar
│   └── [id]/
│       ├── page.tsx     # Post detail (server component)
│       └── PostEditor.tsx # Edit mode with ItemEditForm (client)
├── users/
│   └── page.tsx         # Users list with ListTable
└── api/
    └── posts/
        ├── route.ts     # POST /api/posts (create)
        └── [id]/
            └── route.ts # PATCH, DELETE /api/posts/:id
```

### Components

```
components/
└── CreatePostDialog.tsx  # Dialog with ItemCreateForm
```

## Running the Example

### 1. Install Dependencies

```bash
cd examples/composable-dashboard
pnpm install
```

### 2. Generate Schema and Types

```bash
pnpm generate
```

### 3. Setup Database

```bash
pnpm db:push
```

### 4. Seed Some Data (Optional)

```bash
npx tsx seed.ts
```

Or manually using Prisma Studio:

```bash
pnpm db:studio
```

Create a few users and posts to see the dashboard in action.

### 5. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002)

## Features Demonstrated

### 1. Custom Dashboard (app/page.tsx)

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@opensaas/framework-ui/primitives"
import { CreatePostDialog } from "./components/CreatePostDialog"

// Stats cards using primitives
<Card>
  <CardHeader>
    <CardTitle>Total Posts</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-3xl font-bold">{totalPosts}</p>
  </CardContent>
</Card>

// Create post in dialog
<CreatePostDialog />
```

### 2. ItemCreateForm in Dialog (components/CreatePostDialog.tsx)

```tsx
import { Dialog, DialogContent } from '@opensaas/framework-ui/primitives'
import { ItemCreateForm } from '@opensaas/framework-ui/standalone'
;<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <ItemCreateForm
      fields={config.lists.Post.fields}
      onSubmit={async (data) => {
        await fetch('/api/posts', { method: 'POST', body: JSON.stringify(data) })
        return { success: true }
      }}
    />
  </DialogContent>
</Dialog>
```

### 3. ListTable with SearchBar (app/posts/page.tsx)

```tsx
import { ListTable, SearchBar } from "@opensaas/framework-ui/standalone"

<SearchBar
  onSearch={(query) => /* handle search */}
  placeholder="Search posts..."
/>

<ListTable
  items={posts}
  fieldTypes={{ title: "text", status: "select" }}
  columns={["title", "authorName", "status"]}
  onRowClick={(post) => router.push(`/posts/${post.id}`)}
  sortable
/>
```

### 4. Inline Editing (app/posts/[id]/PostEditor.tsx)

```tsx
import { ItemEditForm, DeleteButton } from '@opensaas/framework-ui/standalone'

{
  editing ? (
    <ItemEditForm
      fields={config.lists.Post.fields}
      initialData={post}
      onSubmit={async (data) => {
        await fetch(`/api/posts/${post.id}`, { method: 'PATCH' })
        return { success: true }
      }}
    />
  ) : (
    <PostDetails post={post} />
  )
}

;<DeleteButton
  onDelete={async () => {
    await fetch(`/api/posts/${post.id}`, { method: 'DELETE' })
    return { success: true }
  }}
/>
```

## Differences from Blog Example

| Feature        | Blog Example            | Composable Dashboard                    |
| -------------- | ----------------------- | --------------------------------------- |
| **Admin UI**   | Uses full `<AdminUI>`   | Custom pages with standalone components |
| **Routing**    | AdminUI handles routing | Custom Next.js routes                   |
| **Navigation** | Built-in sidebar        | Custom header navigation                |
| **Actions**    | Server Actions          | API Routes                              |
| **Create**     | AdminUI create page     | Dialog with ItemCreateForm              |
| **Edit**       | AdminUI edit page       | Inline ItemEditForm                     |
| **List**       | AdminUI ListView        | Custom page with ListTable              |
| **Search**     | AdminUI built-in        | SearchBar component                     |
| **Delete**     | AdminUI confirmation    | DeleteButton component                  |

## When to Use This Approach

✅ **Use Composable Dashboard when:**

- You need custom layouts and branding
- You want to embed admin features in your main app
- You need multi-step workflows or wizards
- You want full control over UX and routing
- You're building a SaaS dashboard with custom features

✅ **Use Full AdminUI when:**

- You need a quick admin panel
- Standard CRUD operations are sufficient
- You want zero configuration
- You're building an internal tool
- You want automatic field-level access control

## Extending This Example

### Add Authentication

```tsx
// middleware.ts
import { NextResponse } from 'next/server'

export function middleware(request) {
  const session = getSession(request)
  if (!session) {
    return NextResponse.redirect('/login')
  }
}
```

### Add Access Control

Update API routes to use OpenSaaS context:

```tsx
// app/api/posts/route.ts
import { getContextWithUser } from '@/lib/context'

const context = getContextWithUser(session.userId)
const post = await context.db.post.create({ data })
// Access control automatically enforced!
```

### Add More Features

- User profile editing
- Image uploads
- Rich text editor
- Comments system
- Tag management
- Analytics dashboard

## Learn More

- [Composability Guide](../../docs/COMPOSABILITY.md) - Complete guide to UI composability
- [Blog Example](../blog) - Using full AdminUI
- [Custom Field Example](../custom-field) - Custom field components
- [OpenSaaS Framework](../../README.md) - Framework overview

## License

MIT
