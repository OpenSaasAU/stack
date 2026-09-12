# Building this app with Claude Code

This project is built on **OpenSaaS Stack** with **authentication** (`@opensaas/stack-auth` / Better-auth) already wired in. You describe the feature you want; Claude implements it against the framework's guardrails. This file tells Claude (and you) the rules that keep changes correct and secure.

## The model

Your whole schema lives in **`opensaas.config.ts`** — lists, fields, access control, and hooks, plus the `authPlugin()` that adds the `User`/`Session`/`Account`/`Verification` lists. `pnpm generate` produces the Contract module (`prisma/contract.ts`), its emitted artifacts (`prisma/contract.json`, `prisma/contract.d.ts`), `prisma.config.ts`, and an access-controlled context in `.opensaas/`. The admin UI is generated from the same config; sign-in/up pages live under `app/`.

The database is Postgres, and only Postgres. `db: { provider: 'postgresql' }` is the whole database block: no connection string, no adapter, no client constructor. `pnpm dev` runs the **Dev database** for this project; set `DATABASE_URL` in `.env` to use a Postgres of your own instead.

## How to ask Claude to build features

Describe the outcome, not the plumbing. For example:

- _"Add a `Comment` list owned by the signed-in user; anyone can read, only the author can edit or delete."_
- _"Add a `role` field to users and let only admins delete posts."_
- _"Add GitHub OAuth sign-in."_

Claude edits `opensaas.config.ts` (and auth config where needed), runs `pnpm generate`, and updates UI/server code.

## Rules Claude must follow

1. **Always go through the context, never the ORM directly.** Use `import { getContext } from '@/.opensaas/context'` and `context.db.<List>`. Better-auth's own writes go through its adapter over `context.unsafe`; application code never reaches for that surface without saying why.
2. **List keys are PascalCase everywhere.** `Post` in the config is `context.db.Post` on the context, and the auth lists are `context.db.User`, `context.db.Session`, `context.db.Account`, `context.db.Verification` — `context.db.post` does not exist and is a compile error.
3. **Reads are composed, then run.** `context.db.Post.where({ status: { equals: 'published' } }).all()` returns rows; `.first()` returns one row or `null`. `where` takes `equals`/`not`/`in`/`notIn`/`lt`/`lte`/`gt`/`gte`/`contains` per column, `AND`/`OR`/`NOT`, and `some`/`every`/`none` on a relation. Reach a relation with `.include('author')`; the included to-one is `Row | null` and must be null-checked, whether or not its column is nullable.
4. **Writes are `create`, `update`, `delete`.** `create({ data })`, `update({ where: { id }, data })`, `delete({ where: { id } })`. A relationship is written as `{ connect: { id } }` on the field that owns the foreign key (`author` on `Post`, never `posts` on `User`), and cleared by assigning `null`. There is no nested `create`/`update`/`delete`/`set`; write several rows atomically inside `context.transaction`.
5. **Use the session in access control.** Access checks receive `{ session }`; gate with it and scope rows with a filter in the `where` vocabulary, e.g. an owner check returns `{ authorId: { equals: session.userId } }`. Anonymous = `session` is null.
6. **Every list needs access control** (`access.operation`: query/create/update/delete). A check returns a boolean or a filter. The auth lists ship closed; open them through `authPlugin({ access })`.
7. **Access denial is silent.** Denied operations return `null` (single) or `[]` (many) — never an error. Always null-check writes:
   ```ts
   const post = await context.db.Post.update({ where: { id }, data })
   if (!post) return { error: 'Not found or access denied' }
   ```
8. **No `any`, no type casts.** Rely on the generated types.
9. **Commit what `pnpm generate` emits, except `.opensaas/`.** `prisma.config.ts`, `prisma/contract.ts`, `prisma/contract.json`, `prisma/contract.d.ts` and `migrations/` are committed alongside the config change that produced them; `.opensaas/` is regenerated and ignored.
10. **Env**: set `BETTER_AUTH_SECRET` in `.env` (`openssl rand -base64 32`); auth URLs default to `http://localhost:3000`. Leave `DATABASE_URL` unset to run on the Dev database.

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
