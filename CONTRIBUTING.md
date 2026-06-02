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

### Test lanes

CI is split into lanes so the common feedback loop stays fast and the slower,
networked checks don't gate every PR. The rationale (gate the security-critical
core, keep flaky/networked checks off the PR) is recorded in
[ADR-0002](./docs/adr/0002-testing-and-ci-strategy.md).

| Lane          | Trigger                             | What it guards                                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fast unit** | every PR (`test.yml` → `test` job)  | `turbo run test` — the Vitest suites across packages, plus lint, format, and browser tests. The quick loop you also run locally with `pnpm test` in a package.                                                                                                                                              |
| **Coverage**  | every PR (`test.yml`)               | `turbo run test:coverage` plus the `coverage` reporter job. Gated only on the security-critical core paths (see [Coverage gating](#coverage-gating)); other packages are report-only.                                                                                                                       |
| **e2e**       | every PR (`test.yml` → `e2e` job)   | Builds the core/auth/ui/cli + create-opensaas-app packages, runs the **isolated scaffold first-run guard** (`create-opensaas-app` → `generate` → `db:push` against the workspace toolchain in a temp dir, no network install), and the Playwright auth flow against the starter-auth production build.      |
| **Nightly**   | `schedule` (cron) + manual dispatch | `nightly.yml` — the heavier/networked checks kept **off** the PR gate: the **published `npm create opensaas-app` e2e** (real `npx create-opensaas-app@latest` install → `generate` → `db:push` → `build` in a temp dir) and the **full `examples/*` build** (`pnpm build:examples`). Failures fail the run. |

The nightly lane runs on `schedule:` + `workflow_dispatch:` only — never on
`pull_request`/`push` — so a registry/network hiccup or a slow examples build
never blocks a PR. Trigger it manually from the Actions tab via "Run workflow"
when you want an on-demand check.

The examples build needs each example's `.env` to `generate` (the same
developer step documented in [Trying an example](#trying-an-example)). The
nightly job creates them deterministically: it copies every example's
`.env.example` to `.env`, forces `DATABASE_URL` to SQLite for the two examples
whose config is `provider: 'sqlite'` but whose `.env.example` defaults to a
PostgreSQL URL (`blog`, `composable-dashboard`), and supplies placeholder
secrets (`OPENAI_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`NEXT_PUBLIC_APP_URL`) as job env so `generate`/`build` don't fail on missing
vars. The one genuinely PostgreSQL example (`rag-openai-chatbot`) keeps its
placeholder URL — `generate`/`build` never open a connection.

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
