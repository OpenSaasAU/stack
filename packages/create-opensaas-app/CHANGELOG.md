# create-opensaas-app

## 0.4.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Delete the Node build; the Generated bundle loads under plain Node from the committed contract

  The `.opensaas/` bundle is erasable TypeScript by contract and loads natively under Node 22.18+, so the compiled twin that existed to serve bundler-less consumers is gone (ADR-0054, withdrawing ADR-0011). Removed:

  - `output.buildTarget` from the config surface. A config that sets it is now a compile error; delete the `output` block (or the key) — nothing replaces it, because `.opensaas/context.ts` is the one specifier both a bundler and plain Node load.

    ```typescript
    // Before
    export default config({
      output: { buildTarget: 'node' },
      // ...
    })

    // After
    export default config({
      // ...
    })
    ```

    A plain-Node consumer imports the bundle entry directly:

    ```typescript
    const { rawOpensaasContext } = await import('./.opensaas/context.ts')
    ```

  - The CLI's Node build step, its `.opensaas/dist/` layout, and `@typescript/native` as a runtime dependency of `@opensaas/stack-cli` (it stays a devDependency, the compiler the package builds and type-checks its own tests with).

  The CLI's tests now run the real `node` binary over a generated bundle with no flags and no loader, and type-check generator output under `erasableSyntaxOnly` and `verbatimModuleSyntax` so a non-erasable construct fails a CLI test before it fails a user's Node.

  `create-opensaas-app` no longer accepts `--db`, and its SQLite-to-PostgreSQL transform is deleted. The scaffolded project uses the database its template declares; change it by editing `db` in the generated `opensaas.config.ts`. The scaffolded `tsconfig.json` now carries `erasableSyntaxOnly` and `verbatimModuleSyntax`, so the type-checker reports a non-erasable config before Node does.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolding needs no database

  The post-scaffold step is now `install` → `generate`. There is no schema-apply
  step, and the `.env` the scaffolder writes sets no `DATABASE_URL` — the first
  `pnpm dev` starts the Dev database for the project and reconciles it.

  ```bash
  npm create opensaas-app@latest my-app
  cd my-app
  pnpm dev   # starts the Dev database, generates, reconciles, runs the app
  ```

  Set `DATABASE_URL` (the commented line in the generated `.env`) to develop
  against a Postgres of your own; no Dev database starts when it is set.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Rewrite each package README against the Prisma 8 surface

  The READMEs now document the API the packages actually ship, replacing the
  Prisma 7 spellings that no longer resolve.

  Reads compose on `context.db` keyed by the list's PascalCase config key and end
  in a terminal, rather than calling a Prisma delegate:

  ```ts
  const posts = await context.db.Post.where({ status: { equals: 'published' } })
    .orderBy({ createdAt: 'desc' })
    .limit(20)
    .all()

  const post = await context.db.Post.where({ id }).first()
  if (!post) return null
  ```

  `findMany`, `findUnique`, `findFirst` and `count()` are gone; the terminals are
  `all()`, `first()`, `aggregate()` and `nearest()`. A denied read is silent, so
  every `first()` result is a null check.

  Writes take an args object with an identity-only `where`, and a relationship is
  set with `connect` or cleared with `null`:

  ```ts
  const updated = await context.db.Post.update({
    where: { id },
    data: { title, author: { connect: { id: authorId } } },
  })
  ```

  The database config documented in each README is the one `DatabaseConfig`
  carries — `provider: 'postgresql'`, `idField`, `timestamps`, `schemas`,
  `extensions` and `client`. `prismaClientConstructor`, `db.url` and
  `extendPrismaSchema` are gone, and the connection is resolved from the
  environment rather than named in the config.

  Review round two swept each README against the built `.d.ts` rather than against
  another doc, and corrected what the grep-shaped sweep had missed:

  - The UI README's theming block documented bare `--background`/`--primary` HSL
    triplets under a `.dark` class. The shipped contract is `--color-*` tokens in
    `oklch()`, resolved through `light-dark()` and switched by `data-theme` — the
    stylesheet's own header says the design exists "without a duplicated `.dark`
    block". Its primitives list also omitted eight real exports (`Textarea`,
    `Popover`, `Calendar`, `TimePicker`, `DateTimePicker`, `Combobox`, `Badge`,
    `Avatar`), and two samples read `config.lists` without awaiting `config`.
  - The tiptap README reused a filter-returning `AccessControl` rule as
    **field-level** `access.update`. `FieldAccess` types those slots as
    boolean-returning, so that is a type error and a runtime
    `InvalidFieldAccessResultError`, not a scoped update.
  - The storage README's upload route was the last copy still casting
    `formData.get(...) as string` / `as 'file' | 'image'` off a
    `FormDataEntryValue | null`.
  - The auth README's Account shape named `providerId: 'credentials'`; better-auth
    1.7 uses `'credential'` for email/password, and the model carries `issuer`.
  - The Vercel Blob README passed `cacheControl` to `vercelBlobStorage()`. The
    provider option is `cacheControlMaxAge` (a number of seconds);
    `VercelBlobStorageConfig` carries an index signature, so the wrong spelling
    type-checked and was silently ignored.

  Round three corrected what round two's sweeps could not see, each having keyed
  on where a construct sat rather than on what it was:

  - The Vercel Blob README's **options listing** still named `cacheControl` 112
    lines above the call site round two fixed, so the page contradicted itself and
    the half a reader consults first was the wrong half.
  - Sixteen hook samples across the docs and the core, cli and example READMEs
    destructured a member the `delete` branch of its args union does not carry, so
    the destructure failed before any in-body `operation` guard could narrow. Three
    more named an argument on no branch at all: `value` and `inputValue` on
    `resolveInput`/`afterOperation`, and `session` on `ResolveInputHookArgs`.
  - The core README carried a third instance of the field-access class — a bare
    `text({ access: … })` excerpt with no enclosing `fields: {` — plus
    `query: true` where `OperationAccess.query` takes a function, a
    `ValidationError` built from a string where the constructor takes `string[]`,
    and a stale claim that `password()` is excluded from reads.
  - The cli README's "What it does" block under `opensaas db update` described
    `opensaas dev`, and called `migrate` a command group when it has no
    subcommands.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps no longer read another user's drafts as an anonymous caller

  `lib/actions/posts.ts` in both templates built its context as
  `getContext({ userId })` from a `getPost(postId, userId?)` whose id is optional.
  `getContext` stores what it is handed as `session ?? null`, so `{ userId: undefined }`
  is a _signed-in_ session with no user: `Post`'s query rule took its `return true`
  branch instead of the published-only filter, and an anonymous caller read drafts.

  The session is now derived from the optional id in one place, so the shape cannot
  be written wrongly at a call site:

  ```typescript
  function sessionFor(userId?: string) {
    return userId ? { userId } : undefined
  }

  export async function getPost(postId: string, userId?: string) {
    const context = await getContext(sessionFor(userId))

    return context.db.Post.where({ id: { equals: postId } }).first()
  }
  ```

  The templates are copied from `examples/starter` and `examples/starter-auth` at
  build time, which is where the fix lives.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Templates are the Prisma 8 starters: Postgres under `opensaas dev`, PascalCase `context.db` keys, and no generated artifacts in the copy

  The scaffolder copies `examples/starter` and `examples/starter-auth`, both now on `db: { provider: 'postgresql' }` with every `context.db` call on the query-value surface. The template copy strips `prisma.config.ts`, `prisma/contract.*` and `migrations/` (ADR-0067): the post-scaffold `generate` recreates the first three and the first `pnpm dev` writes `migrations/` for the new project's own database.

  What a template leaves out is decided per whole path segment, against each entry's path relative to the example — so a checkout under a directory named after one of those patterns (`…/prisma-8/…`) no longer excludes the entire tree, and a source file such as `lib/prisma-helpers.ts` is kept. A copy that produces no files, or no `package.json`, now fails the build instead of publishing an empty template.

  ```bash
  npm create opensaas-app@latest my-app
  cd my-app
  pnpm dev   # starts the Dev database, reconciles it, serves the app and /admin
  ```

### Patch Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

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
