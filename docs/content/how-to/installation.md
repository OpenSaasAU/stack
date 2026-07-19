# Getting Started

This guide walks you through building your first app with OpenSaaS Stack — from an empty folder to a running admin UI you can extend with Claude Code. It takes about five minutes.

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Basic familiarity with Next.js and TypeScript

## 1. Scaffold your project

```bash
npm create opensaas-app@latest my-app
```

The scaffolder does the setup for you: it installs dependencies, runs the
generator, and creates a local SQLite database. When it finishes you have a
complete, runnable Next.js project.

{% callout type="info" %}
Want authentication out of the box? Add `--with-auth`. To skip the automatic
install/generate/db:push and run those steps yourself, add `--no-install`.
{% /callout %}

## 2. Run the app

```bash
cd my-app
pnpm dev
```

Visit:

- **App**: [http://localhost:3000](http://localhost:3000)
- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin) — auto-generated CRUD for every list

## 3. Build features with Claude Code

Your project ships ready for [Claude Code](/docs/how-to/claude-code): a project
`CLAUDE.md` describing the framework's patterns, plus MCP tooling. Open the
project in Claude Code and describe what you want to build:

- _"Add a comments feature to posts."_
- _"Add a `publishedAt` timestamp and only show published posts to anonymous users."_
- _"Add authentication."_

Claude makes the change in `opensaas.config.ts`, regenerates, and wires up the
UI — staying within the access-control guardrails.

## What just got generated

Your schema lives in `opensaas.config.ts`. Running the generator (which the
scaffolder did for you, and which you re-run with `pnpm generate`) produces:

- **`prisma/schema.prisma`** — the Prisma schema
- **`.opensaas/types.ts`** — TypeScript types for your lists
- **`.opensaas/context.ts`** — the access-controlled context factory

You interact with the database through the generated context, which enforces
access control automatically:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext() // pass a session for authenticated access
const posts = await context.db.post.findMany()
```

Access-denied operations return `null` or `[]` instead of throwing, so always
null-check writes:

```typescript
const post = await context.db.post.update({ where: { id }, data })
if (!post) {
  // Either it doesn't exist, or the current session can't access it.
  return { error: 'Not found or access denied' }
}
```

## The development loop

When you change `opensaas.config.ts` by hand:

```bash
pnpm generate   # regenerate schema, types, and context
pnpm db:push    # apply schema changes to the database
```

Use `pnpm db:studio` to browse and edit data in Prisma Studio.

## Switching to PostgreSQL

The starter uses SQLite for zero-setup local development. To move to Postgres,
set `DATABASE_URL` in `.env`, change `provider` to `'postgresql'` in
`opensaas.config.ts`, swap the adapter to `@prisma/adapter-pg`, then re-run
`pnpm generate && pnpm db:push`. See the [Config System](/docs/concepts/config)
for adapter examples.

## Next steps

- **[Quick Start](/docs/tutorials/quick-start)** — the condensed version, plus manual setup for an existing Next.js app
- **[Building with Claude Code](/docs/how-to/claude-code)** — the AI-assisted workflow in depth
- **[Access Control](/docs/concepts/access-control)** — how the engine secures every operation
- **[Field Types](/docs/concepts/field-types)** — all available fields
- **[Hooks](/docs/concepts/hooks)** — data transformation and side effects

{% callout type="info" %}
Contributing to OpenSaaS Stack itself? The monorepo setup (building packages,
running tests, changesets) lives in `CONTRIBUTING.md` in the repository.
{% /callout %}
