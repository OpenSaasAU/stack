# Building this app with Claude Code

This project is built on **OpenSaaS Stack**. You describe the feature you want; Claude implements it against the framework's guardrails. This file tells Claude (and you) the rules that keep changes correct and secure.

## The model

Your whole schema lives in **`opensaas.config.ts`** — lists, fields, access control, and hooks. From it, `pnpm generate` produces the Prisma schema, TypeScript types, and an access-controlled database context in `.opensaas/`. The admin UI at `/admin` is generated from the same config.

## How to ask Claude to build features

Describe the outcome, not the plumbing. For example:

- _"Add a `Comment` list: text body, a relationship to `Post`, and an author relationship to `User`. Anyone can read; only signed-in users can create; only the author can edit or delete."_
- _"Add a `publishedAt` timestamp to `Post` and only show published posts to anonymous visitors."_
- _"Add a `coverImage` image field to `Post`."_
- _"Add authentication."_ (installs and wires `@opensaas/stack-auth`)

Claude edits `opensaas.config.ts`, runs `pnpm generate`, and updates any UI/server code.

## Rules Claude must follow

1. **Always go through the context, never Prisma directly.** Use `import { getContext } from '@/.opensaas/context'` and `context.db.<list>...`. Direct Prisma access bypasses access control.
2. **Every list needs access control.** Define `access.operation` (query/create/update/delete) on each list. A check returns a boolean, or a Prisma filter that scopes which rows are visible.
3. **Access denial is silent.** Denied operations return `null` (single) or `[]` (many) — never an error. Always null-check writes:
   ```ts
   const post = await context.db.post.update({ where: { id }, data })
   if (!post) return { error: 'Not found or access denied' }
   ```
4. **No `any`, no type casts.** Rely on the generated types; keep everything strongly typed.
5. **Field/list names are PascalCase** in the config (`Post`, `BlogPost`); the context uses camelCase (`context.db.post`).
6. **The database adapter** is `PrismaBetterSqlite3` from `@prisma/adapter-better-sqlite3`, constructed with `{ url }` (see `opensaas.config.ts`). Don't introduce the old `new Database()` form.

## The loop

After changing `opensaas.config.ts`:

```bash
pnpm generate   # regenerate schema, types, context
pnpm db:push    # apply to the database
pnpm dev        # run the app + admin UI
```

## Get more help from the plugin

For guided, wizard-style feature building, install the OpenSaaS Stack Claude Code plugin once:

```
/plugin marketplace add OpenSaasAU/stack
/plugin install opensaas-stack@opensaas-stack-marketplace
```

This project already registers the OpenSaaS MCP server in `.claude/settings.json`, so the `opensaas_*` tools are available here. Learn more: https://stack.opensaas.au/docs/guides/claude-code
