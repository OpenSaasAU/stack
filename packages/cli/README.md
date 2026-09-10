# @opensaas/stack-cli

Command-line tools for OpenSaas Stack - code generation and development utilities.

## Installation

```bash
pnpm add -D @opensaas/stack-cli
```

## Commands

The CLI carries `generate`, `init`, `dev` and `migrate`, plus the command groups
`db` and `mcp`. `migrate` is a single command with options, not a group — it has
no subcommands.

### `opensaas generate`

Generate the schema contract and TypeScript types from your
`opensaas.config.ts`.

```bash
opensaas generate
```

**What it does:**

1. Reads `opensaas.config.ts` from the current directory
2. Writes `prisma/contract.ts`, the contract module
3. Shells to `prisma contract emit`, which writes `prisma/contract.json` and
   `prisma/contract.d.ts` — the artifacts the runtime executes
4. Writes the generated bundle: `.opensaas/types.ts`, `.opensaas/context.ts`,
   `.opensaas/lists.ts`, `.opensaas/tables.ts`, `.opensaas/plugin-types.ts`
5. Writes `prisma.config.ts` at the project root
6. Seeds an Extension contract space under `migrations/` for every extension
   pack the config declares

**Example package.json script:**

```json
{
  "scripts": {
    "generate": "opensaas generate"
  }
}
```

### `opensaas dev`

Start the Dev database, generate, reconcile the schema, and run the app. This is
the whole local loop in one process.

```bash
opensaas dev
```

Pass your own app command after `--` to run something other than `next dev`:

```bash
opensaas dev -- vite dev
```

The loop owns the Dev database's data directory, the staged generation and the
app child, so it is the only thing holding a connection. Leave it running while
you work.

### `opensaas db update`

Apply the staged schema change through the running `opensaas dev` loop — what
`pnpm db:update` points at.

```bash
opensaas db update
```

The command opens **no connection of its own**: it hands the request to the
running loop and exits non-zero when none is listening. A destructive change
needs consent, passed through to Prisma's `--confirm` as the database name (the
Dev database's is `postgres`):

```bash
opensaas db update --confirm postgres
```

`update` is the only subcommand under `db`. There is no `opensaas db migrate` —
production applies committed migrations with the Prisma CLI (`prisma db
migrate`).

**What it does:**

1. Sends one reconcile request to the `opensaas dev` loop already running
2. Exits — non-zero if no loop is listening, or if the change needs a
   `--confirm` token it was not given

It is not a watcher and it does not stay resident: the watching, regenerating
and Ctrl+C-until-stopped behaviour all belong to [`opensaas dev`](#opensaas-dev),
which must already be running for this command to have anything to talk to.

**Example package.json scripts:**

```json
{
  "scripts": {
    "dev": "opensaas dev",
    "db:update": "opensaas db update"
  }
}
```

### `opensaas init`

Create a new OpenSaas Stack project.

**Note:** This command delegates to `create-opensaas-app` for scaffolding. It's kept for backwards compatibility.

```bash
npx @opensaas/stack-cli init my-project
```

**Recommended:** Use `npm create opensaas-app` instead:

```bash
npm create opensaas-app@latest my-project
```

**Options:**

- `project-name` - Name of your project (lowercase, numbers, hyphens only)
- `--with-auth` - Include Better-auth integration

**Examples:**

```bash
# Basic project
npx @opensaas/stack-cli init my-app

# With authentication
npx @opensaas/stack-cli init my-app --with-auth
```

**What happens:**

This command runs `npx create-opensaas-app@latest` with the provided arguments. See the [create-opensaas-app package](../create-opensaas-app) for full details.

**After init:**

```bash
cd my-project
pnpm install
pnpm dev
```

`pnpm dev` starts the Dev database, generates, reconciles the schema and runs
the app. Nothing needs creating first.

### `opensaas migrate`

Migrate an existing Prisma, KeystoneJS, or Next.js project to OpenSaas Stack.

```bash
opensaas migrate [options]
```

**Options:**

- `--with-ai` - Enable AI-guided migration with Claude Code
- `--type <type>` - Force project type detection (prisma, nextjs, keystone)

**What it does:**

1. Detects project type (Prisma, KeystoneJS, Next.js)
2. Analyzes schema and counts models
3. With `--with-ai`: Sets up Claude Code integration
4. Provides next steps for migration

**Examples:**

```bash
# Basic migration analysis
opensaas migrate

# AI-guided migration (recommended)
opensaas migrate --with-ai

# Force project type
opensaas migrate --type prisma --with-ai
```

**AI-Assisted Migration (with --with-ai):**

```
🚀 OpenSaas Stack Migration

✔ Detected: prisma, nextjs
✔ Found 8 models
   ├─ User (6 fields)
   ├─ Post (10 fields)
   ├─ Comment (5 fields)
   └─ ...
✔ Claude Code ready
   ├─ Created .claude directory
   ├─ Generated migration assistant
   └─ Registered MCP server

✅ Analysis complete!

🤖 Next Steps:

   1. Open this project in Claude Code
   2. Ask: "Help me migrate to OpenSaas Stack"
   3. Follow the interactive wizard
```

**After running:**

1. Open project in Claude Code
2. Ask: "Help me migrate to OpenSaas Stack"
3. Answer wizard questions about:
   - Database configuration
   - Authentication needs
   - Access control patterns
   - Admin UI preferences
4. Claude generates `opensaas.config.ts`
5. Install dependencies and run `opensaas generate`

**Manual Migration:**

Without `--with-ai`, the command provides project analysis and you create the config manually.

**See also:** [Migration Guide](https://stack.opensaas.au/docs/how-to/migrate-from-keystone)

## Usage in Projects

### Quick Start (New Projects)

**Recommended:** Use `create-opensaas-app`:

```bash
npm create opensaas-app@latest my-project
cd my-project
pnpm install
pnpm dev
```

**Alternative:** Via CLI package:

```bash
npx @opensaas/stack-cli init my-project
cd my-project
pnpm install
pnpm dev
```

### Manual Setup (Existing Projects)

```bash
# Install CLI
pnpm add -D @opensaas/stack-cli

# Add scripts to package.json
{
  "scripts": {
    "generate": "opensaas generate",
    "dev": "opensaas dev",
    "db:update": "opensaas db update"
  }
}

# Generate code
pnpm generate

# Or run the whole dev loop
pnpm dev
```

### Development Workflow

`opensaas dev` runs the Dev database, the generator and the app together, so one
terminal is the normal case:

```bash
pnpm dev
```

When you change the config, the loop stages the new generation and tells you what
applying it would do. Accept it from a second terminal:

```bash
pnpm db:update
```

That command talks to the running loop, so `pnpm dev` has to be up for it to do
anything.

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm generate
      - run: pnpm test
```

## Configuration

The CLI reads `opensaas.config.ts` from the current working directory.

**Example config:**

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text(),
      },
    }),
  },
})
```

`postgresql` is the only provider. The connection is resolved at run time from
`DIRECT_DATABASE_URL`, then `DATABASE_URL`, then the Dev database `opensaas dev`
starts — there is no `db.url` key and no `prismaClientConstructor`. See the
[config API reference](https://stack.opensaas.au/docs/reference/config-api) for
the complete `db` key list.

## Output Files

### Contract module (`prisma/contract.ts`)

The schema, as a TypeScript module: one table per list, the columns each field
declares, the relations between them and the indexes. `prisma contract emit`
reads it and writes `prisma/contract.json` and `prisma/contract.d.ts` beside it —
those two are what the runtime executes.

### Generated bundle (`.opensaas/`)

- `types.ts` — row, create-input and update-input interfaces per list
- `context.ts` — `getContext`, `rawOpensaasContext` and `config`
- `lists.ts`, `tables.ts`, `plugin-types.ts`

**Example `types.ts` output:**

```typescript
export interface Post extends Stack$Row<Stack$Contract, Remainder, 'Post'> {}
export interface PostCreateInput extends Stack$CreateInput<Stack$Contract, Remainder, 'Post'> {}
export interface PostUpdateInput extends Stack$UpdateInput<Stack$Contract, Remainder, 'Post'> {}
```

Each interface is its own named symbol resolved lazily from the emitted
contract, so a list's shape follows the contract without being restated here.

### Migrations (`migrations/`)

`generate` seeds one Extension contract space per declared extension pack. These
files are committed — they are derived from `db.extensions` and the installed
pack version, and a stale copy is a wrong-version migration.

### `prisma.config.ts`

Written at the project root, for the Prisma CLI.

## Troubleshooting

### Config not found

```
Error: Could not find opensaas.config.ts
```

**Solution:** Ensure you're running the command from the directory containing `opensaas.config.ts`.

### TypeScript errors in config

```
Error: Failed to load configuration
```

**Solution:** Check your `opensaas.config.ts` for TypeScript errors. The CLI uses `tsx` to execute the config.

### Permission errors

```
Error: EACCES: permission denied
```

**Solution:** Ensure you have write permissions for `prisma/` and `.opensaas/` directories.

## Examples

### Changing the schema during development

With `pnpm dev` running, edit `opensaas.config.ts`. The loop regenerates,
stages the change and reports what applying it would do. Accept it from a second
terminal:

```bash
pnpm db:update
```

If the change would destroy data, pass the database name as consent — `postgres`
for the Dev database:

```bash
pnpm db:update --confirm postgres
```

### Preparing a production migration

Planning a migration needs a database to plan against, and a direct
(non-pooled) connection, which `DIRECT_DATABASE_URL` supplies:

```bash
DIRECT_DATABASE_URL=... npx prisma migration plan
```

Commit the resulting `migrations/` directory. The release step applies it:

```bash
npx prisma db migrate
```

## Learn More

- [Core Package](../core/README.md) - Config and field types
- [OpenSaas Stack](../../README.md) - Stack overview
- [Examples](../../examples) - Working examples

## License

MIT
