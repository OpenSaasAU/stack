# create-opensaas-app

## 0.3.5

### Patch Changes

- [#1041](https://github.com/OpenSaasAU/stack/pull/1041) [`182153c`](https://github.com/OpenSaasAU/stack/commit/182153cb976b14ef67673d0eeef7925d950bfa10) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade Prisma packages to `^7.9.1`, keeping the CLI, client, and driver adapters on the same release. Scaffolded PostgreSQL projects now pin `@prisma/adapter-pg` to `^7.9.1`.

## 0.3.4

### Patch Changes

- [#973](https://github.com/OpenSaasAU/stack/pull/973) [`8f76533`](https://github.com/OpenSaasAU/stack/commit/8f765333e3067c741c69f535927cc82115c60ed1) Thanks [@borisno2](https://github.com/borisno2)! - Comment cleanup only, no behavior change: removed restating/narration comments, kept TSDoc on public config options and field builders, and kept external API/behavior constraint notes (Prisma, S3, Vercel Blob, Keystone parity, Next.js SSR, Zod).

## 0.3.3

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

## 0.3.2

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.3.1

### Patch Changes

- [#508](https://github.com/OpenSaasAU/stack/pull/508) [`559cb28`](https://github.com/OpenSaasAU/stack/commit/559cb282e304619f24d8549c8f81df03b49c019c) Thanks [@borisno2](https://github.com/borisno2)! - Include `templates/**` in the turbo `build` outputs so a cached build restores the generated templates instead of only `dist/`, fixing the e2e scaffold guard's "Template basic not found" failure on a cache hit.

## 0.3.0

### Minor Changes

- [#433](https://github.com/OpenSaasAU/stack/pull/433) [`3e6c8f5`](https://github.com/OpenSaasAU/stack/commit/3e6c8f5e51c2f2d73b4c17e7d47eed46e4ac93c0) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded projects are now Claude-Code-ready out of the box. Every template ships an AI bundle — a concise, project-oriented `CLAUDE.md` (the framework's hard rules plus example "ask Claude to build X" prompts) and a `.claude/settings.json` that registers the OpenSaaS MCP server for the project — so your third step is simply to describe a feature to Claude Code.

  The bundle is included when AI tooling is enabled (the default / `--with-ai`). Opting out (declining the prompt) removes the bundle from the generated project via `removeAiTooling`.

- [#429](https://github.com/OpenSaasAU/stack/pull/429) [`e4a1cd5`](https://github.com/OpenSaasAU/stack/commit/e4a1cd5d0255c5114039a85b7c95cd0ee58350a6) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolding now runs setup for you, so the flow is just **scaffold → `pnpm dev` → build with Claude**.

  After copying the template, the CLI runs `install` → `generate` → `db:push` itself, so a new project is ready to run with no further commands. If a step fails it stops and prints a recoverable message naming the failed step and its retry command, instead of leaving a raw stack trace. The final "next steps" now shows the three-step flow and points you at building features with Claude Code.

  Pass `--no-install` (or `--skip-install`) to skip the auto-run and get the full manual command list instead.

- [#463](https://github.com/OpenSaasAU/stack/pull/463) [`09a16db`](https://github.com/OpenSaasAU/stack/commit/09a16db4c375109235c3a1c2d244ebca72231de4) Thanks [@borisno2](https://github.com/borisno2)! - Add an optional `--db postgres` flag (and matching database prompt) to scaffold a PostgreSQL-ready project instead of the SQLite default.

  ```bash
  # PostgreSQL-ready: pg driver adapter, Postgres .env, migrate scripts
  npm create opensaas-app my-app --db postgres

  # Force SQLite and skip the database prompt (unchanged default behaviour)
  npm create opensaas-app my-app --db sqlite
  ```

  With `--db postgres` the generated `opensaas.config.ts` uses the `PrismaPg` driver adapter (`new pg.Pool({ connectionString: process.env.DATABASE_URL })`), the `.env` / `.env.example` carry `DATABASE_URL` (pooled) and `DIRECT_DATABASE_URL` (direct) placeholders, and the `@prisma/adapter-pg` + `pg` dependencies replace the SQLite ones. The `migrate` / `migrate:deploy` scripts are kept so you can apply migrations to your database. Without the flag, SQLite remains the zero-setup default and the interactive prompt offers SQLite (default) or PostgreSQL.

- [#426](https://github.com/OpenSaasAU/stack/pull/426) [`7c8f628`](https://github.com/OpenSaasAU/stack/commit/7c8f628aac038a86f303f9a34f00ff1abe387503) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded projects now start with a runnable environment file, so `pnpm generate` and `pnpm db:push` work immediately with no manual `.env` setup.

  Previously the basic template shipped an empty `.env` and a PostgreSQL-defaulted `.env.example` even though its config uses SQLite, so the very first documented command failed with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Now the basic (SQLite) template writes a canonical `.env` (`DATABASE_URL="file:./dev.db"`) plus a matching `.env.example`, and the `--with-auth` template seeds `.env` from its own `.env.example` so the Better-auth variables are preserved.

  The scaffolder's project-name validation, `package.json` version rewriting, and env generation are now pure, unit-tested helpers in `src/lib/`. The unimplemented `--template` flag has been removed so advertised flags match real behaviour.

### Patch Changes

- [#431](https://github.com/OpenSaasAU/stack/pull/431) [`521d91d`](https://github.com/OpenSaasAU/stack/commit/521d91da9480aec626cd4765081fb71f0ca3bc05) Thanks [@borisno2](https://github.com/borisno2)! - Fix the with-auth starter template: align all auth URLs to port 3000 (`.env.example` and the `auth-client` default no longer point at 3003), and make the sign-in / sign-up / forgot-password pages legible in light and dark mode by replacing the dark `bg-gray-500/600` card backgrounds with semantic theme tokens (`bg-card`, `text-card-foreground`, `text-muted-foreground`, `text-primary`).

- [#458](https://github.com/OpenSaasAU/stack/pull/458) [`c7cc2fc`](https://github.com/OpenSaasAU/stack/commit/c7cc2fc9562fb50a9302925978feace14b934511) Thanks [@borisno2](https://github.com/borisno2)! - Replace the in-place scaffold smoke test with an isolated first-run guard that scaffolds the real CLI into an OS temp dir and runs generate + db:push against the workspace toolchain (no network install), and add `--no-auth`/`--no-ai` flags so the CLI can run fully non-interactively.

## 0.2.0

### Minor Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - # Add MCP Server for AI-Assisted Development

  ## New Features

  ### CLI Package (@opensaas/stack-cli)
  - **New `opensaas mcp` command group** for AI-assisted development:
    - `opensaas mcp install` - Install MCP server in Claude Code
    - `opensaas mcp uninstall` - Remove MCP server from Claude Code
    - `opensaas mcp start` - Start MCP server directly (for debugging)
  - **Feature-driven development tools**:
    - Interactive feature implementation wizards (authentication, blog, comments, file-upload, semantic-search)
    - Live documentation search from stack.opensaas.au
    - Code generation following OpenSaaS best practices
    - Smart feature suggestions based on your current app
    - Config validation
  - **MCP tools available in Claude Code**:
    - `opensaas_implement_feature` - Start feature wizard
    - `opensaas_feature_docs` - Search documentation
    - `opensaas_list_features` - Browse available features
    - `opensaas_suggest_features` - Get personalized recommendations
    - `opensaas_validate_feature` - Validate implementations

  ### create-opensaas-app
  - **Interactive MCP setup prompt** during project creation
  - Option to enable AI development tools automatically
  - Automatic installation of MCP server if user opts in
  - Helpful instructions if MCP installation is declined or fails

  ## Installation

  Enable AI development tools for an existing project:

  ```bash
  npx @opensaas/stack-cli mcp install
  ```

  Or during project creation:

  ```bash
  npm create opensaas-app@latest my-app
  # When prompted: Enable AI development tools? → yes
  ```

  ## Benefits
  - **Build apps faster**: Describe what you want to build, get complete implementations
  - **Feature-driven development**: Work with high-level features instead of low-level config
  - **Best practices baked in**: Generated code follows OpenSaaS Stack patterns
  - **Live documentation**: Always up-to-date docs from the official site
  - **Single toolkit**: All developer commands in one CLI

  ## Example Usage

  With Claude Code installed and the MCP server enabled, you can:

  ```
  You: "I want to build a food tracking app"

  Claude Code uses MCP tools to:
  1. Ask clarifying questions about requirements
  2. Implement authentication feature (wizard)
  3. Create custom Food and FoodLog lists
  4. Generate complete code with UI and access control
  5. Provide testing and deployment guidance
  ```

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

### Patch Changes

- d2d1720: fix package templates

## 0.1.3

### Patch Changes

- efe2357: Fix dependencies
- efe2357: fix getting started package imports

## 0.1.2

### Patch Changes

- 63197c6: Fix package versions
