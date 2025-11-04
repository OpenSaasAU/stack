# OpenSaas Stack

> **⚠️ Work in Progress - Alpha Stage**
>
> This project is currently in active development and is in an alpha state. APIs may change in patches, and some features are still being implemented. Use in production at your own risk.

A modern stack for building admin-heavy applications with Next.js App Router, designed to be AI-agent-friendly with built-in security guardrails.

## Features

- 🔒 **Access Control First**: Database operations automatically enforce access control patterns
- 🤖 **AI-Safe Architecture**: Built to be easy for AI coding agents to work with safely
- ⚡ **Modern Next.js Integration**: Works seamlessly with App Router and Server Components
- 🎯 **Type-Safe**: Full TypeScript support with generated types from schema
- 🔄 **Prisma-Powered**: Built on Prisma for reliable database operations
- 🧩 **Fully Extensible**: Custom field types without modifying core code
- 🎨 **Fully Composable UI**: Use primitives, fields, standalone components, or complete admin UI
- ♿ **Accessible**: Built with Radix UI and shadcn/ui for production-ready components
- 🔐 **Authentication Ready**: Optional Better-auth integration with OAuth support
- 🤖 **AI Assistant Integration**: MCP server for seamless AI assistant access
- 📁 **File Storage**: Abstract storage interface with S3 and Vercel Blob adapters
- 📝 **Rich Text Editing**: Tiptap integration for advanced content editing

## Project Structure

This is a monorepo containing:

### Packages

- **`packages/core`**: The core OpenSaas stack (config, fields, access control, generators)
- **`packages/cli`**: CLI tools for code generation and development
- **`packages/ui`**: Composable React UI components (primitives, fields, standalone components, full admin UI)
- **`packages/auth`**: Better-auth integration for authentication and sessions
- **`packages/mcp`**: Model Context Protocol server for AI assistant integration
- **`packages/tiptap`**: Rich text editor integration (third-party field example)
- **`packages/storage`**: Abstract storage interface for file uploads
- **`packages/storage-s3`**: S3-compatible storage adapter (AWS S3, R2, MinIO, etc.)
- **`packages/storage-vercel`**: Vercel Blob storage adapter

### Examples

- **`examples/blog`**: Basic blog example demonstrating the stack
- **`examples/custom-field`**: Custom field types demonstration
- **`examples/composable-dashboard`**: Composable UI components examples
- **`examples/auth-demo`**: Authentication integration with Better-auth
- **`examples/mcp-demo`**: MCP server integration for AI assistants
- **`examples/tiptap-demo`**: Tiptap rich text editor integration
- **`examples/json-demo`**: JSON field type demonstration
- **`examples/file-upload-demo`**: File upload and image handling with storage adapters

## Quick Start

### New Project (Recommended)

Get started with a new project in 5 minutes:

```bash
# Create a new project
npm create opensaas-app@latest my-app
cd my-app

# Install dependencies
pnpm install

# Generate Prisma schema and types
pnpm generate

# Create database
pnpm db:push

# Start dev server
pnpm dev
```

**With authentication:**

```bash
npm create opensaas-app@latest my-app --with-auth
```

Your app is now running at [http://localhost:3000](http://localhost:3000)!

Visit `/admin` to see your auto-generated admin UI.

### Deploy to Production

Ready to deploy? Follow our [Deployment Guide](https://stack.opensaas.au/docs/guides/deployment) to deploy to Vercel + Neon in ~15 minutes.

---

### Monorepo Development

Working on the OpenSaas Stack itself? Here's how to get started:

#### 1. Install Dependencies

```bash
pnpm install
```

#### 2. Build All Packages

```bash
# Build all packages in the monorepo
pnpm build
```

#### 3. Try an Example

Choose one of the examples to get started:

#### Blog Example (Basic)

```bash
cd examples/blog

# Copy environment file
cp .env.example .env

# Generate Prisma schema and types from config
pnpm generate

# Push schema to database (creates SQLite file)
pnpm db:push

# Start development server
pnpm dev
```

#### Auth Demo (with Better-auth)

```bash
cd examples/auth-demo

# Copy environment file
cp .env.example .env

# Generate and setup database
pnpm generate
pnpm db:push

# Start development server
pnpm dev
```

#### File Upload Demo (with storage adapters)

```bash
cd examples/file-upload-demo

# Copy environment file and configure storage
cp .env.example .env

# Generate and setup database
pnpm generate
pnpm db:push

# Start development server
pnpm dev
```

### 4. Test the Example

Create a test script to see access control in action:

```bash
# Create a test file
cat > examples/blog/test.ts << 'EOF'
import { prisma } from './lib/context'
import { getContext, getContextWithUser } from './lib/context'

async function test() {
  console.log('🧪 Testing OpenSaas Stack\n')

  // Create a user
  console.log('1. Creating a user...')
  const user = await prisma.user.create({
    data: {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'hashed_password_here'
    }
  })
  console.log('✅ User created:', user.id, user.name)

  // Create a post as that user
  console.log('\n2. Creating a post as Alice...')
  const contextAlice = await getContextWithUser(user.id)
  const post = await contextAlice.db.post.create({
    data: {
      title: 'My First Post',
      slug: 'my-first-post',
      content: 'Hello world!',
      internalNotes: 'Remember to add images later',
      author: { connect: { id: user.id } }
    }
  })
  console.log('✅ Post created:', post?.id, post?.title)
  console.log('   Internal notes visible to author:', post?.internalNotes)

  // Try to read as anonymous user
  console.log('\n3. Reading post as anonymous user...')
  const contextAnon = await getContext()
  const postAnon = await contextAnon.db.post.findUnique({
    where: { id: post!.id }
  })
  console.log('❌ Post not visible (draft):', postAnon)

  // Publish the post
  console.log('\n4. Publishing the post as Alice...')
  const publishedPost = await contextAlice.db.post.update({
    where: { id: post!.id },
    data: { status: 'published', publishedAt: new Date() }
  })
  console.log('✅ Post published:', publishedPost?.status)

  // Try to read as anonymous user again
  console.log('\n5. Reading published post as anonymous user...')
  const postAnonPublished = await contextAnon.db.post.findUnique({
    where: { id: post!.id }
  })
  console.log('✅ Post visible:', postAnonPublished?.title)
  console.log('🔒 Internal notes hidden:', postAnonPublished?.internalNotes)

  // Create another user
  console.log('\n6. Creating another user (Bob)...')
  const bob = await prisma.user.create({
    data: {
      name: 'Bob',
      email: 'bob@example.com',
      password: 'hashed_password_here'
    }
  })
  console.log('✅ User created:', bob.id, bob.name)

  // Try to update Alice's post as Bob
  console.log('\n7. Trying to update Alice\'s post as Bob...')
  const contextBob = await getContextWithUser(bob.id)
  const updatedByBob = await contextBob.db.post.update({
    where: { id: post!.id },
    data: { title: 'Hacked!' }
  })
  console.log('❌ Access denied (silent failure):', updatedByBob)

  // Try to update as Alice
  console.log('\n8. Updating post as Alice (owner)...')
  const updatedByAlice = await contextAlice.db.post.update({
    where: { id: post!.id },
    data: { title: 'My Updated Post' }
  })
  console.log('✅ Update successful:', updatedByAlice?.title)

  console.log('\n🎉 All tests passed!')

  // Cleanup
  await prisma.post.deleteMany()
  await prisma.user.deleteMany()
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
EOF

# Run the test
npx tsx test.ts
```

## How It Works

### 1. Define Your Schema

Create `opensaas.config.ts`:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, select } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

export default config({
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
  lists: {
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
    Post: list({
      fields: {
        title: text(),
        content: text(),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) => {
            // Non-authenticated users only see published posts
            if (!session) return { status: { equals: 'published' } }
            return true
          },
          update: isAuthor, // Only author can update
        },
      },
    }),
  },
})
```

### 2. Generate Schema and Types

```bash
pnpm generate
```

This generates:

- `prisma/schema.prisma` - Prisma schema
- `.opensaas/types.ts` - TypeScript types

### 3. Use in Your App

```typescript
import { getContext } from './lib/context'

export async function updatePost(postId: string, data: any) {
  const context = await getContext()

  // Access control is automatically enforced
  const post = await context.db.post.update({
    where: { id: postId },
    data,
  })

  if (!post) {
    // Either doesn't exist or user doesn't have access
    return { error: 'Access denied' }
  }

  return { post }
}
```

## Access Control Features

### Operation-Level Access

Control who can query, create, update, or delete records:

```typescript
access: {
  operation: {
    query: true,  // Everyone can read
    create: isSignedIn,  // Must be signed in to create
    update: isAuthor,  // Only author can update
    delete: isAuthor,  // Only author can delete
  }
}
```

### Filter-Based Access

Return Prisma filters to scope access:

```typescript
const isAuthor: AccessControl = ({ session }) => {
  return { authorId: { equals: session.userId } }
}
```

### Field-Level Access

Control access to individual fields:

```typescript
internalNotes: text({
  access: {
    read: isAuthor, // Only author can see
    update: isAuthor, // Only author can modify
  },
})
```

### Silent Failures

When access is denied, operations return `null` or `[]` instead of throwing errors. This prevents information leakage.

## Architecture

### Core Components

1. **Config System** (`src/config/`): Schema definition and validation
2. **Field Types** (`src/fields/`): Field type definitions (text, relationship, etc.)
3. **Access Control** (`src/access/`): Access control engine
4. **Context** (`src/context/`): Database wrapper with access control
5. **Generators** (`src/generator/`): Prisma schema and TypeScript type generation

### Access Control Flow

When you call `context.db.post.update()`:

1. Check operation-level access (can this user update posts?)
2. Apply access filter as Prisma where clause (which posts can they update?)
3. Check field-level access (which fields can they modify?)
4. Execute database operation
5. Filter readable fields from result
6. Return result (or null if no access)

## Development

### Building the Core Package

```bash
cd packages/core
pnpm build
```

### Running the Example

```bash
cd examples/blog
pnpm dev
```

## Extensibility

### Custom Field Types

OpenSaas is designed to be fully extensible without modifying core code. Field types are self-contained with their own validation, schema generation, and UI components.

**Built-in field types:**

- `text()` - String field with validation
- `integer()` - Number field with validation
- `checkbox()` - Boolean field
- `timestamp()` - Date/time field with auto-now support
- `password()` - String field (excluded from reads)
- `select()` - Enum field with predefined options
- `relationship()` - Foreign key relationship
- `json()` - JSON data storage
- `image()` - Image upload with storage adapters
- `file()` - File upload with storage adapters

**Third-party field packages:**

- `richText()` from `@opensaas/stack-tiptap` - Rich text editor with Tiptap

**Create your own:**

See `examples/custom-field` for a complete working example with:

- **ColorPickerField**: Custom color picker component (global registration)
- **SlugField**: Auto-generating slug field (per-field override)

Learn more in [CLAUDE.md](./CLAUDE.md#customizing-ui-components).

## Composability

OpenSaas UI offers four levels of abstraction - choose what fits your needs:

### Level 1: Primitives

```tsx
import { Button, Input, Card, Table } from '@opensaas/stack-ui/primitives'
;<Card>
  <Input placeholder="Search..." />
  <Button>Submit</Button>
</Card>
```

### Level 2: Field Components

```tsx
import { TextField, SelectField } from '@opensaas/stack-ui/fields'
;<form>
  <TextField name="email" label="Email" value={email} onChange={setEmail} />
  <SelectField name="role" label="Role" options={roles} />
</form>
```

### Level 3: Standalone Components

```tsx
import { ItemCreateForm, ListTable, SearchBar } from '@opensaas/stack-ui/standalone'
;<ItemCreateForm
  fields={config.lists.Post.fields}
  onSubmit={async (data) => {
    const post = await createPost(data)
    return { success: !!post }
  }}
/>
```

### Level 4: Full Admin UI

```tsx
import { AdminUI } from '@opensaas/stack-ui'
;<AdminUI context={context} serverAction={handleAction} />
```

See [docs/COMPOSABILITY.md](./docs/COMPOSABILITY.md) for complete guide.

## File Storage

OpenSaas provides abstract file storage through the `@opensaas/stack-storage` package with multiple adapters:

### Storage Adapters

- **S3-Compatible** (`@opensaas/stack-storage-s3`): Works with AWS S3, Cloudflare R2, MinIO, and other S3-compatible services
- **Vercel Blob** (`@opensaas/stack-storage-vercel`): Optimized for Vercel deployments

### Usage

```typescript
import { config } from '@opensaas/stack-core'
import { image, file } from '@opensaas/stack-core/fields'
import { s3Storage } from '@opensaas/stack-storage-s3'

export default config({
  storage: s3Storage({
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    endpoint: process.env.S3_ENDPOINT, // Optional for R2/MinIO
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  }),
  lists: {
    Post: list({
      fields: {
        coverImage: image({
          storage: { maxFileSize: 5 * 1024 * 1024 }, // 5MB
        }),
        attachment: file({
          storage: { maxFileSize: 10 * 1024 * 1024 }, // 10MB
        }),
      },
    }),
  },
})
```

See `examples/file-upload-demo` for complete working example.

## Roadmap

- [x] **Phase 1**: Core foundation (config, fields, generators)
- [x] **Phase 2**: Access control engine
- [x] **Phase 3**: Hooks system (resolveInput, validateInput, etc.)
- [x] **Phase 4**: CLI tooling (generate, dev watch mode)
- [x] **Phase 5**: Composable UI (shadcn/ui primitives, standalone components)
- [x] **Phase 6**: Better-auth integration
- [x] **Phase 7**: MCP server for AI assistant integration
- [x] **Phase 8**: File storage abstraction and adapters
- [x] **Phase 9**: Third-party field packages (Tiptap, JSON)
- [ ] **Phase 10**: Documentation and guides
- [ ] **Phase 11**: Testing utilities and helpers
- [ ] **Phase 12**: Beta release and stability improvements

## Philosophy

### AI-Safe by Design

OpenSaas is designed to be safe for AI coding agents to work with:

- **Clear patterns**: Simple, predictable APIs
- **Access control first**: Security is automatic, not an afterthought
- **Type safety**: Catch errors at compile time
- **Silent failures**: No information leakage

### Inspired by KeystoneJS

OpenSaas takes inspiration from KeystoneJS but modernized for:

- Next.js App Router (not a separate GraphQL server)
- Server Components and Server Actions
- Embedded admin UI (not a separate app)
- AI-agent-friendly development

## License

MIT
