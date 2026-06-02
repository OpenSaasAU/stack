# Contributing to OpenSaas Stack

Thanks for working on OpenSaas Stack itself. This guide covers the **monorepo** workflow. If you just want to _build an app_ with the stack, start with the [README Quick Start](./README.md#quick-start-3-steps) instead.

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)

## Setup

```bash
pnpm install      # install all workspace dependencies
pnpm build        # build publishable packages + the docs site (turbo)
pnpm dev          # watch-build packages
```

`pnpm build` is scoped to the publishable `packages/*` and the docs site so it
stays **deterministic on a clean checkout** — it does not build `examples/*`.
Each example needs a developer-created `.env` (gitignored) before it can
`generate`, so building examples from a fresh clone would otherwise fail. The
template flows are covered instead by the `e2e` job and the scaffold guard. To
build an example, set up its `.env` first (see [Trying an example](#trying-an-example)),
then run its build directly:

```bash
pnpm --filter opensaas-blog-example build   # builds one example (after its .env exists)
pnpm build:examples                         # builds all examples (each needs its .env)
```

## Repository layout

- `packages/*` — published packages (core, cli, ui, auth, tiptap, rag, storage\*, create-opensaas-app)
- `examples/*` — runnable examples; each is named `opensaas-<name>-example`
- `docs/` — the documentation site (Next.js), published at https://stack.opensaas.au/
- `claude-plugins/*` — Claude Code plugins (`opensaas-stack`, `opensaas-migration`)
- `specs/` — design documents and specifications

## Trying an example

```bash
cd examples/blog
cp .env.example .env     # SQLite by default
pnpm generate            # generate Prisma schema + types from opensaas.config.ts
pnpm db:push             # create the database
pnpm dev
```

The `starter` and `starter-auth` examples are the **source of truth** for the
`create-opensaas-app` templates — they are copied into the published package at
build time, so changes to them flow to scaffolded projects.

## Building the docs site

```bash
pnpm --filter opensaas-stack-docs build
```

The docs site builds **without any secret**. Its `/api/search` route uses
`OPENAI_API_KEY` for semantic search; when the key is unset the route degrades
gracefully (search returns empty results) instead of crashing page-data
collection. Set `OPENAI_API_KEY` to enable live search.

## Testing

Tests use Vitest. Run them per package, e.g.:

```bash
cd packages/core && pnpm test
cd packages/cli && pnpm test
```

End-to-end tests use Playwright (`pnpm test:e2e` from the repo root).

## Before you commit

Always run:

```bash
pnpm lint
pnpm manypkg fix
pnpm format
```

Match versions of any shared dependency across packages and examples (manypkg
enforces this). Keep all types strongly typed — avoid `any` and type casting;
`unknown` is for internal use only.

## Versioning

This monorepo uses two independent mechanisms:

- **Changesets** for npm packages under `packages/*`. Every change to a package
  needs a changeset in `.changeset/` (`patch` for fixes, `minor` for features,
  `major` only when explicitly intended). Releases are automated by the
  changesets GitHub Action.
- **Plugin versions** for `claude-plugins/*`, bumped directly in each plugin's
  `plugin.json` and the matching entry in `.claude-plugin/marketplace.json`.

When working with Claude Code in this repo, the `pr-changeset` and
`plugin-version` skills handle these for you.

## Architecture notes

See [`CLAUDE.md`](./CLAUDE.md) for the in-depth architectural guide (access
control engine, hooks, config system, generators, field types) and the
per-package `CLAUDE.md` files for package-specific patterns.

## Reporting issues

Issues live in [GitHub Issues](https://github.com/OpenSaasAU/stack/issues).
