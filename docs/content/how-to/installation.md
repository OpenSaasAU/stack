# Installation

Set up a Stack project — from an empty folder to a running admin UI you can extend with Claude Code. It takes about five minutes. (New to Stack? The [Quick Start](/docs/tutorials/quick-start) tutorial is the gentler on-ramp.)

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Basic familiarity with Next.js and TypeScript

## 1. Scaffold your project

```bash
npm create opensaas-app@latest my-app
```

The scaffolder does the setup for you: it installs dependencies and runs the
generator. When it finishes you have a complete, runnable Next.js project. It
reaches no database — the first `pnpm dev` brings one up.

{% callout type="info" %}
Want authentication out of the box? Add `--with-auth`. To skip the automatic
install and generate and run them yourself, add `--no-install`.
{% /callout %}

## 2. Run the app

```bash
cd my-app
pnpm dev
```

`pnpm dev` is `opensaas dev`: it starts a local Postgres the stack runs
in-process, applies your schema to it, then starts Next. Nothing to install, no
connection string to set.

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

- **`prisma/contract.json`** and **`prisma/contract.d.ts`** — the emitted schema contract; commit both
- **`prisma.config.ts`** — Prisma CLI configuration
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

Leave `pnpm dev` running. It watches `opensaas.config.ts`, and on a change it
regenerates and applies the new schema for you — an added field or list is live
without a restart.

A change that would drop data stops short of applying: the loop prints the plan
and leaves both the database and the running app on the old schema. Approve it
in a second terminal, while `pnpm dev` is still running:

```bash
pnpm db:update
```

## Using your own Postgres

Set `DATABASE_URL` and the stack starts no database of its own — it uses the one
you named. That is the route to a Postgres you manage: a shared development
database, a container, or anything with an extension you install yourself.
Leave it unset and you get the local one back.

## Next steps

- **[Quick Start](/docs/tutorials/quick-start)** — the condensed version, plus manual setup for an existing Next.js app
- **[Building with Claude Code](/docs/how-to/claude-code)** — the AI-assisted workflow in depth
- **[Access Control](/docs/concepts/access-control)** — how the engine secures every operation
- **[Field Types](/docs/concepts/field-types)** — all available fields
- **[Hooks](/docs/concepts/hooks)** — data transformation and side effects

{% callout type="info" %}
Contributing to Stack itself? The monorepo setup (building packages,
running tests, changesets) lives in `CONTRIBUTING.md` in the repository.
{% /callout %}
