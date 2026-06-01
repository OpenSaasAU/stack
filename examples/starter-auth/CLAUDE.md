# Building this app with Claude Code

This project is built on **OpenSaaS Stack** with **authentication** (`@opensaas/stack-auth` / Better-auth) already wired in. You describe the feature you want; Claude implements it against the framework's guardrails. This file tells Claude (and you) the rules that keep changes correct and secure.

## The model

Your whole schema lives in **`opensaas.config.ts`** — lists, fields, access control, and hooks, plus the `authPlugin()` that adds the `User`/`Session`/`Account`/`Verification` lists. `pnpm generate` produces the Prisma schema, TypeScript types, and an access-controlled context in `.opensaas/`. The admin UI is generated from the same config; sign-in/up pages live under `app/`.

## How to ask Claude to build features

Describe the outcome, not the plumbing. For example:

- _"Add a `Comment` list owned by the signed-in user; anyone can read, only the author can edit or delete."_
- _"Add a `role` field to users and let only admins delete posts."_
- _"Add GitHub OAuth sign-in."_

Claude edits `opensaas.config.ts` (and auth config where needed), runs `pnpm generate`, and updates UI/server code.

## Rules Claude must follow

1. **Always go through the context, never Prisma directly.** Use `import { getContext } from '@/.opensaas/context'` and `context.db.<list>...`. Direct Prisma access bypasses access control.
2. **Use the session in access control.** Access checks receive `{ session }`; gate with it and scope rows with Prisma filters, e.g. an owner check returns `{ authorId: { equals: session.userId } }`. Anonymous = `session` is null.
3. **Every list needs access control** (`access.operation`: query/create/update/delete). A check returns a boolean or a Prisma filter.
4. **Access denial is silent.** Denied operations return `null` (single) or `[]` (many) — never an error. Always null-check writes:
   ```ts
   const post = await context.db.post.update({ where: { id }, data })
   if (!post) return { error: 'Not found or access denied' }
   ```
5. **No `any`, no type casts.** Rely on the generated types.
6. **List names are PascalCase** in config (`Post`); the context uses camelCase (`context.db.post`).
7. **The database adapter** is `PrismaBetterSqlite3` from `@prisma/adapter-better-sqlite3`, constructed with `{ url }`. Don't use the old `new Database()` form.
8. **Env**: set `BETTER_AUTH_SECRET` in `.env` (`openssl rand -base64 32`); auth URLs default to `http://localhost:3000`.

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
