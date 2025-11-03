# Quick Start

Get up and running with OpenSaaS Stack in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- pnpm package manager
- Basic knowledge of Next.js and TypeScript

## Installation

### 1. Create a New Project

```bash
npx create-next-app@latest my-app
cd my-app
```

### 2. Install OpenSaaS Stack

```bash
pnpm add @opensaas/stack-core
pnpm add -D prisma
```

### 3. Create Your Config

Create `opensaas.config.ts` in your project root:

```typescript
import { config, list } from '@opensaas/stack-core/config'
import { text, timestamp, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
  lists: {
    Post: list({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        content: text({
          validation: { isRequired: true },
        }),
        publishedAt: timestamp(),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session?.userId,
          update: ({ session }) => !!session?.userId,
          delete: ({ session }) => !!session?.userId,
        },
      },
    }),
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
  },
})
```

### 4. Generate Prisma Schema

```bash
pnpm opensaas generate
```

This creates:

- `prisma/schema.prisma` - Database schema
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - Context factory

### 5. Set Up Database

```bash
npx prisma db push
npx prisma generate
```

### 6. Use the Context in Your App

Create a server action in `app/actions.ts`:

```typescript
'use server'

import { getContext } from '@/.opensaas/context'

export async function getPosts() {
  const context = getContext()
  return context.db.post.findMany({
    include: { author: true },
  })
}

export async function createPost(data: { title: string; content: string }) {
  const context = getContext({ userId: 'user-1' }) // In real app, get from session
  return context.db.post.create({ data })
}
```

### 7. Create a Page

Create `app/page.tsx`:

```typescript
import { getPosts } from './actions'

export default async function HomePage() {
  const posts = await getPosts()

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Posts</h1>
      <div className="space-y-4">
        {posts.map((post) => (
          <div key={post.id} className="border p-4 rounded-lg">
            <h2 className="text-2xl font-semibold">{post.title}</h2>
            <p className="text-gray-600 mt-2">{post.content}</p>
            {post.author && (
              <p className="text-sm text-gray-500 mt-2">By {post.author.name}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

## What's Next?

Now that you have a basic setup, explore these topics:

- **[Access Control](/docs/core-concepts/access-control)** - Learn how to secure your data
- **[Field Types](/docs/core-concepts/field-types)** - Explore all available field types
- **[Hooks](/docs/core-concepts/hooks)** - Add data transformation and side effects
- **[Admin UI](/docs/packages/ui)** - Add a complete admin interface

{% callout type="info" %}
**Tip**: The access control engine automatically secures all database operations. No record is returned without passing access checks.
{% /callout %}

## Common Issues

### "Cannot find module '@/.opensaas/context'"

Make sure you've run `pnpm opensaas generate` to create the generated files.

### "PrismaClient is not configured"

Run `npx prisma generate` to generate the Prisma Client.

### Access control returns empty results

Check your access control functions - they might be denying access. Remember that denied access returns `[]` or `null`, not an error.
