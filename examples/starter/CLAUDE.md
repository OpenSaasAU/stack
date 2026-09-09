# Building this app with Claude Code

This project is built on **OpenSaaS Stack**. You describe the feature you want; Claude implements it against the framework's guardrails. This file tells Claude (and you) the rules that keep changes correct and secure.

## The model

Your whole schema lives in **`opensaas.config.ts`** — lists, fields, access control, and hooks. From it, `pnpm generate` produces the Contract module (`prisma/contract.ts`), its emitted artifacts (`prisma/contract.json`, `prisma/contract.d.ts`), `prisma.config.ts`, and an access-controlled database context in `.opensaas/`. The admin UI at `/admin` is generated from the same config.

The database is Postgres, and only Postgres. `db: { provider: 'postgresql' }` is the whole database block: no connection string, no adapter, no client constructor. `pnpm dev` runs the **Dev database** for this project; set `DATABASE_URL` in `.env` to use a Postgres of your own instead.

## How to ask Claude to build features

Describe the outcome, not the plumbing. For example:

- _"Add a `Comment` list: text body, a relationship to `Post`, and an author relationship to `User`. Anyone can read; only signed-in users can create; only the author can edit or delete."_
- _"Add a `publishedAt` timestamp to `Post` and only show published posts to anonymous visitors."_
- _"Add a `coverImage` image field to `Post`."_
- _"Add authentication."_ (installs and wires `@opensaas/stack-auth`)

Claude edits `opensaas.config.ts`, runs `pnpm generate`, and updates any UI/server code.

## Rules Claude must follow

1. **Always go through the context, never the ORM directly.** Use `import { getContext } from '@/.opensaas/context'` and `context.db.<List>`. `context.unsafe` is Prisma's own query lanes with no access control; reaching for it is a visible act.
2. **List keys are PascalCase everywhere.** `Post` in the config is `context.db.Post` on the context — `context.db.post` does not exist and is a compile error.
3. **Reads are composed, then run.** `context.db.Post.where({ status: { equals: 'published' } }).all()` returns rows; `.first()` returns one row or `null`. `where` takes `equals`/`not`/`in`/`notIn`/`lt`/`lte`/`gt`/`gte`/`contains` per column, `AND`/`OR`/`NOT`, and `some`/`every`/`none` on a relation. Reach a relation with `.include('author')`; the included to-one is `Row | null` and must be null-checked, whether or not its column is nullable.
4. **Writes are `create`, `update`, `delete`.** `create({ data })`, `update({ where: { id }, data })`, `delete({ where: { id } })`. A relationship is written as `{ connect: { id } }` on the field that owns the foreign key (`author` on `Post`, never `posts` on `User`), and cleared by assigning `null`. There is no nested `create`/`update`/`delete`/`set`; write several rows atomically inside `context.transaction`.
5. **Every list needs access control.** Define `access.operation` (query/create/update/delete) on each list. A check returns a boolean, or a filter in the same `where` vocabulary that scopes which rows are visible.
6. **Access denial is silent.** Denied operations return `null` (single) or `[]` (many) — never an error. Always null-check writes:
   ```ts
   const post = await context.db.Post.update({ where: { id }, data })
   if (!post) return { error: 'Not found or access denied' }
   ```
7. **No `any`, no type casts.** Rely on the generated types; keep everything strongly typed.
8. **Commit what `pnpm generate` emits, except `.opensaas/`.** `prisma.config.ts`, `prisma/contract.ts`, `prisma/contract.json`, `prisma/contract.d.ts` and `migrations/` are committed alongside the config change that produced them; `.opensaas/` is regenerated and ignored.

## The loop

After changing `opensaas.config.ts`:

```bash
pnpm dev        # regenerates, reconciles the database, runs the app + admin UI
```

`pnpm dev` watches `opensaas.config.ts`, so an edit regenerates and reconciles
on its own. A change that would destroy data is not applied: the plan is
printed, the app keeps serving the previous schema, and `pnpm db:update` in a
second terminal applies it.

## Get more help from the plugin

For guided, wizard-style feature building, install the OpenSaaS Stack Claude Code plugin once:

```
/plugin marketplace add OpenSaasAU/stack
/plugin install opensaas-stack@opensaas-stack-marketplace
```

This project already registers the OpenSaaS MCP server in `.claude/settings.json`, so the `opensaas_*` tools are available here. Learn more: https://stack.opensaas.au/docs/how-to/claude-code
