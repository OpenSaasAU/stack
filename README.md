# OpenSaas Stack

> **Beta.** The onboarding path and core APIs are stable enough to build on; some advanced features are still evolving. Pin versions for production.

A config-first stack for building admin-heavy applications with Next.js App Router — designed so you can **describe features to an AI coding agent (Claude Code) and let the framework handle the technical complexity**, with access control enforced on every database operation by default.

- 🔒 **Access control first** — every `context.db` operation is automatically secured; denied reads return `null`/`[]` (no information leakage).
- 🤖 **Built for Claude Code** — clear, predictable patterns plus a shipped project `CLAUDE.md` and MCP tooling, so you build by describing features.
- ⚡ **Config-first** — define lists, fields, and access rules once; generate the Prisma schema, TypeScript types, and a typed context.
- 🧩 **Composable & extensible** — shadcn/ui primitives → field components → standalone CRUD → full admin UI; add custom field types without forking core.

## Quick Start (3 steps)

You need Node.js 18+ and `pnpm` (`npm install -g pnpm`).

```bash
# 1. Scaffold — installs deps, generates the schema, and creates a SQLite DB for you
npm create opensaas-app@latest my-app

# 2. Run
cd my-app
pnpm dev
```

**3. Build with Claude Code.** Open the project in Claude Code and describe what you want — e.g. _"add a comments feature to posts"_ or _"add authentication"_. The scaffolded project ships a `CLAUDE.md` and MCP tooling so Claude builds within the framework's guardrails.

Your app runs at [http://localhost:3000](http://localhost:3000); the auto-generated admin UI is at [`/admin`](http://localhost:3000/admin).

**Want authentication from the start?**

```bash
npm create opensaas-app@latest my-app --with-auth
```

> The scaffolder runs install → generate → db:push for you. To skip that and run the steps yourself, pass `--no-install`.

📚 **[Full documentation →](https://stack.opensaas.au/docs)** · **[Quick Start guide →](https://stack.opensaas.au/docs/tutorials/quick-start)** · **[Building with Claude Code →](https://stack.opensaas.au/docs/how-to/claude-code)**

## How it works

### 1. Define your schema in `opensaas.config.ts`

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, select, relationship } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

// Access control returns a boolean, or a Prisma filter that scopes the rows.
const isAuthor: AccessControl = ({ session }) =>
  session ? { authorId: { equals: session.userId } } : false

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text(),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          // Anonymous users only see published posts; authors see their own drafts too.
          query: ({ session }) => (session ? true : { status: { equals: 'published' } }),
          update: isAuthor,
          delete: isAuthor,
        },
      },
    }),
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
  },
})
```

### 2. Generate

```bash
pnpm generate   # → prisma/schema.prisma, .opensaas/types.ts, .opensaas/context.ts
pnpm db:push    # creates the database
```

### 3. Use the access-controlled context in your app

```typescript
import { getContext } from '@/.opensaas/context'

export async function getPosts() {
  const context = await getContext() // pass a session for authenticated access
  // Access control is enforced automatically.
  return context.db.post.findMany({ include: { author: true } })
}
```

Denied operations return `null` (single) or `[]` (many) rather than throwing, so callers can't distinguish "denied" from "doesn't exist". Always null-check writes:

```typescript
const post = await context.db.post.update({ where: { id }, data })
if (!post) return { error: 'Not found or access denied' }
```

## What's in the box

**Packages**

| Package                                        | Purpose                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@opensaas/stack-core`                         | Config system, fields, access-control engine, hooks, generators (MCP runtime via `@opensaas/stack-core/mcp`) |
| `@opensaas/stack-cli`                          | `opensaas generate` / `dev` and the migration tooling                                                        |
| `@opensaas/stack-ui`                           | Composable admin UI — primitives, field components, standalone CRUD, full admin                              |
| `@opensaas/stack-auth`                         | Better-auth integration (sessions, OAuth, MCP adapter via `@opensaas/stack-auth/mcp`)                        |
| `@opensaas/stack-tiptap`                       | Rich-text `richText()` field (third-party field example)                                                     |
| `@opensaas/stack-rag`                          | Semantic search with vector embeddings                                                                       |
| `@opensaas/stack-storage` (+ `-s3`, `-vercel`) | File/image uploads with pluggable storage adapters                                                           |
| `create-opensaas-app`                          | `npm create opensaas-app` project scaffolder                                                                 |

**Examples** live in [`examples/`](./examples): `starter`, `starter-auth`, `blog`, `auth-demo`, `composable-dashboard`, `custom-field`, `json-demo`, `file-upload-demo`, `mcp-demo`, `rag-ollama-demo`, `rag-openai-chatbot`, `tiptap-demo`.

## Composable UI

Choose your level of abstraction:

```tsx
import { Button, Card } from '@opensaas/stack-ui/primitives' // 1. shadcn/ui primitives
import { TextField, SelectField } from '@opensaas/stack-ui/fields' // 2. field components
import { ItemCreateForm, ListTable } from '@opensaas/stack-ui/standalone' // 3. standalone CRUD
import { AdminUI } from '@opensaas/stack-ui' // 4. full admin UI
```

See [`examples/composable-dashboard`](./examples/composable-dashboard) and the [UI docs](https://stack.opensaas.au/docs/reference/ui).

## Learn more

- **[Quick Start](https://stack.opensaas.au/docs/tutorials/quick-start)** — build a working app
- **[Migrating from Keystone](https://stack.opensaas.au/docs/how-to/migrate-from-keystone)** — the canonical Keystone → stack guide (run `npx @opensaas/stack-cli migrate` to get started)
- **[Building with Claude Code](https://stack.opensaas.au/docs/how-to/claude-code)** — the AI-assisted workflow
- **[Access Control](https://stack.opensaas.au/docs/concepts/access-control)** · **[Field Types](https://stack.opensaas.au/docs/concepts/field-types)** · **[Hooks](https://stack.opensaas.au/docs/concepts/hooks)**
- **[Authentication](https://stack.opensaas.au/docs/how-to/authentication)** · **[Storage](https://stack.opensaas.au/docs/how-to/storage)** · **[RAG](https://stack.opensaas.au/docs/reference/rag)**
- **[Deployment](https://stack.opensaas.au/docs/how-to/deploy)** — ship to production on Vercel + Postgres with `prisma migrate`

## Contributing & monorepo development

Working on OpenSaas Stack itself (not building an app with it)? See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for monorepo setup, building packages, running tests, and the changeset/plugin-version workflow.

## License

MIT
