# Contributing to OpenSaas Stack

Thanks for working on OpenSaas Stack itself. This guide covers the **monorepo** workflow. If you just want to _build an app_ with the stack, start with the [README Quick Start](./README.md#quick-start-3-steps) instead.

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)

## Setup

```bash
pnpm install      # install all workspace dependencies
pnpm build        # build all packages (turbo)
pnpm dev          # watch-build packages
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

## Testing

Tests use Vitest. Run them per package, e.g.:

```bash
cd packages/core && pnpm test
cd packages/cli && pnpm test
```

End-to-end tests use Playwright (`pnpm test:e2e` from the repo root).

### Coverage gating

Coverage is reported for every package but **gated only on the
security-critical core paths** — `src/access/**`, `src/context/**` (the
read/write path, including the Write Pipeline, Hook Pipeline, and
nested-operation registry), and `src/validation/**` in `@opensaas/stack-core`.
These use Vitest per-glob, per-file thresholds set at/just below current levels,
so `pnpm --filter @opensaas/stack-core test:coverage` exits non-zero (and the PR
fails) if coverage on those paths regresses. All other packages (`storage`,
`rag`, `auth`, `ui`, …) stay **report-only** — no thresholds, no forced coverage
work. The rationale (a ratchet on what matters, not blanket coverage) is recorded
in [ADR-0002](./docs/adr/0002-testing-and-ci-strategy.md).

Vitest test discovery excludes `**/dist/**`, so a build running before tests
(via the `test → build` turbo dependency) never inflates the test/file count
with compiled `dist/**/*.test.js` duplicates.

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
