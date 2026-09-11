# @opensaas/stack-cli

Command-line tools for OpenSaas Stack: code generation, the dev loop, and migration utilities.

## Purpose

Turns `opensaas.config.ts` into the database contract and the generated bundle, and runs the development loop that keeps a project's database reconciled with it.

## Key Files & Commands

### Binary (`bin/opensaas.js`)

Entry point exposing the `opensaas` CLI command

### Commands (`src/commands/`)

- `generate.ts` - One-time generation
- `dev.ts` - The dev loop: dev database, staged generation, reconcile, app spawn
- `db.ts` - `opensaas db update`, the promoting wrapper the loop's `pnpm db:update` points at
- `init.ts` - Project scaffolding (delegates to `create-opensaas-app`)
- `mcp.ts` - Dev-assistant MCP server management (`mcp install`/`uninstall`/`start`)
- `migrate.ts` - Migration from Prisma/KeystoneJS/Next.js projects

### Generators (`src/generator/`)

- `contract-module.ts` - Renders `prisma/contract.ts`, the **Contract module**
- `prisma-config.ts` - Renders `prisma.config.ts` (Prisma's own CLI configuration)
- `extension-spaces.ts` - Seeds each declared extension pack's contract space under `migrations/`
- `contract-emit.ts` - Shells to `prisma contract emit` for `contract.json` and `contract.d.ts`
- `types.ts` - Renders `.opensaas/types.ts`
- `lists.ts` - Renders `.opensaas/lists.ts`, the `Lists` type namespace
- `context.ts` - Renders `.opensaas/context.ts`, the context factory
- `tables.ts` - Renders `.opensaas/tables.ts`, the dependency-set table and constraint map
- `plugin-types.ts` - Renders `.opensaas/plugin-types.ts`
- Supporting modules: `output-paths.ts`, `config-load.ts`, `extension.ts`, `prisma-cli.ts`

**No schema language is produced at any point.** Core derives the contract (`deriveContract` in `@opensaas/stack-core/contract`); this package renders it as TypeScript and hands it to Prisma's own emitter (ADR-0040).

## Architecture

### Config Loading

Uses `jiti` to execute the TypeScript config:

```typescript
const jiti = createJiti(import.meta.url)
const config = jiti('./opensaas.config.ts').default
```

The config's default export may be a `Promise` when plugins are present, so every consumer resolves it rather than reading it directly.

### Generator Pipeline

1. Load config from `opensaas.config.ts`
2. Run every plugin's `beforeGenerate` hook
3. Validate — field configs, `needs` declarations, relations, the database config and its extension packs — refusing by name before anything is written
4. Derive the contract in core, and render the **Contract module** to `prisma/contract.ts`
5. Render `prisma.config.ts`
6. Render the `.opensaas/` bundle: `types.ts`, `lists.ts`, `tables.ts`, `context.ts`, `plugin-types.ts`
7. Run every plugin's `afterGenerate` hook, so a plugin's rewrite is what the artifacts describe
8. Seed each declared pack's **extension contract space** under `migrations/`
9. Shell to `prisma contract emit` for `prisma/contract.json` and `prisma/contract.d.ts`
10. Check the emitted relation graph against the config-derived one, and fail when they disagree

(No MCP files are generated — MCP tools are derived at request time by `@opensaas/stack-core/mcp`.)

### The dev loop (`src/commands/dev.ts`)

`opensaas dev` is a foreground sidecar: no daemon, no registry, no reset command.

1. Start the **Dev database** — core's `startDevDatabase`, an in-process PGlite behind a socket on a free loopback port, with its state file under the bundle directory
2. Generate
3. Run Prisma's reconcile against the database
4. Spawn the app (`next dev` by default, `opensaas dev -- <command>` otherwise) with **no `DATABASE_URL` injected**, stdin closed
5. Watch `opensaas.config.ts`

On a config change, generation is **staged behind reconciliation**: it emits to a staging directory, plans the update, and promotes the contract and bundle only once the plan applies. A destructive plan stops at Prisma's consent prompt on boot; mid-session it leaves bundle and database at the previous schema, prints the plan and the `pnpm db:update` instruction, and keeps serving. The loop restarts the app child after a destructive promote, because a cached client survives HMR.

Reset the Dev database by deleting `.opensaas/dev-db/`. Setting `DATABASE_URL` is the **Database escape**: no Dev database starts (ADR-0063).

## CLI Usage

### Generate Command

```bash
opensaas generate
```

Outputs, in order: the Contract module, `prisma.config.ts`, the TypeScript types, the `Lists` namespace, the dependency-set table and constraint map, the context factory, the plugin types, each declared pack's migration space, and finally the two emitted contract artifacts.

### Dev Command

```bash
# Start the dev database, generate, reconcile and run `next dev`
opensaas dev

# Run something else in place of `next dev`
opensaas dev -- tsx seed.ts
```

### Db Update Command

```bash
opensaas db update
opensaas db update --confirm postgres   # consent for a destructive change
```

Runs **through the loop** rather than beside it: the loop holds the database, the staged generation and the app child, so this command opens no connection of its own and errors when nothing is listening. Prisma asks for the database name as its consent token; the Dev database's is `postgres`.

## Generated Files

### Contract Module (`prisma/contract.ts`)

The single declared source of truth for the database's shape. It is **standalone and fully literal** — it imports nothing from `opensaas.config.ts` — so the contract builder's purity rules hold by construction rather than by discipline.

### Contract Artifacts (`prisma/contract.json`, `prisma/contract.d.ts`)

Written by `prisma contract emit` from the module. Both are committed, diffable and byte-deterministic. The `.d.ts` carries the read and write field shapes, per-field nullability and codec, the domain-to-column mapping and the relation graph with cardinality, so nothing downstream re-derives them. CI re-runs generation and fails on a dirty tree covering both, plus each pack's migration space.

### Prisma CLI Config (`prisma.config.ts`)

```typescript
// ⚠️  GENERATED FILE - DO NOT EDIT
// Generated by 'opensaas generate' from opensaas.config.ts.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { definePrismaConfig } from 'prisma/config'
import { defineConfig } from '@prisma/orm-postgres/config'
import { findDatabaseUrl } from '@opensaas/stack-core'
import pgvector from '@prisma/orm-extension-pgvector/control'

// The Prisma CLI evaluates this file without loading a .env of its own, and
// `process.loadEnvFile` throws when the file is absent.
const envFile = join(import.meta.dirname, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export default definePrismaConfig({
  orm: defineConfig({
    contract: './prisma/contract.ts',
    output: './prisma',
    extensions: [pgvector],
    db: { connection: findDatabaseUrl() },
  }),
})
```

**Key points:**

- Generated automatically by `opensaas generate`, at the project root, never relocated
- It imports each declared pack's `/control` descriptor and **never the app config**: a config import would drag the app's plugins, hooks and environment reads into every CLI invocation
- `findDatabaseUrl()` is core's one discovery rule — `DATABASE_URL` if set, else the running Dev database's state file
- Used by Prisma's CLI, not by the application runtime

### Types (`.opensaas/types.ts`)

The file declares the **contract remainder** — the per-list facts the emitted Contract artifacts cannot carry — and instantiates the generics `@opensaas/stack-core` exports, keyed by the emitted `Contract`. Scalar types, nullability, relation arity, foreign-key ownership and column defaults are read from the contract and are never written here (ADR-0052).

```typescript
import type { Contract } from '../prisma/contract.d.js'
import type { CreateInput, Row, SecuredList, UpdateInput } from '@opensaas/stack-core'

export type Remainder = {
  Post: {
    computed: { excerpt: string }
    output: Record<never, never>
    input: Record<never, never>
    needs: { excerpt: 'content' }
  }
}

export interface Post extends Row<Contract, Remainder, 'Post'> {}
export interface PostCreateInput extends CreateInput<Contract, Remainder, 'Post'> {}
export interface PostUpdateInput extends UpdateInput<Contract, Remainder, 'Post'> {}
export interface PostList extends SecuredList<Contract, Remainder, 'Post'> {}
export interface PostTxList extends SecuredList<Contract, Remainder, 'Post', true> {}
```

`PostTxList` is the transaction-bound face — the one difference is that it carries `forUpdate()` — which is what makes a row lock taken outside a transaction a compile error.

The type-only import of the emitted declarations is spelled `contract.d.js`,
not `contract.d.ts`: the Contract module (`prisma/contract.ts`) sits in the same
directory and TypeScript resolves `./contract.d.ts` to **it**. The import is
erased, so no loader ever sees the specifier.

### Context Factory (`.opensaas/context.ts`)

One ORM client per process, constructed from the committed `contract.json` rather than from a generated client tree:

```typescript
import { getContext as getOpensaasContext, requireOrmHandle } from '@opensaas/stack-core'
import { resolveRuntimeConnection } from '@opensaas/stack-core/client'
import { originTripwire } from '@opensaas/stack-core/origin'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import postgres from '@prisma/orm-postgres/runtime'
import type { Contract } from '../prisma/contract.d.js'
import contractJson from '../prisma/contract.json' with { type: 'json' }

function createClient(config: OpenSaasConfig) {
  return postgres<Contract>({
    contractJson,
    extensions: [],
    middleware: [originTripwire],
    ...resolveRuntimeConnection(config.db.client),
  })
}
```

The tripwire goes in unconditionally, never as a configured option: a statement executed by neither surface is refused before it compiles (ADR-0059). `resolveRuntimeConnection` calls `db.client.pg` and reads the URL lookup, so it runs once per process under the client singleton and never on a config load — nothing that only reads the config opens a connection.

The real file additionally carries the config-promise resolution, the `globalThis` singleton, the emitted tables, `getContext(session?)` and `rawOpensaasContext`.

### The Generated Bundle

Every file in `.opensaas/` is **erasable TypeScript by contract**, checked under `erasableSyntaxOnly` and `verbatimModuleSyntax` in this package's tests: relative imports carry explicit `.ts` extensions, value imports never go through the host's path aliases, and plain Node loads the bundle by type-stripping with no compiled twin (ADR-0054).

## Integration Points

### With @opensaas/stack-core

- Core derives the contract and owns the validation refusals; this package renders and writes
- Field builders describe their own contract contribution, so no generator switches on a field type

### With @opensaas/stack-auth

- The auth plugin's `beforeGenerate` contributes its derived lists and any namespaces they need, and generation picks them up like any other config content

### With MCP (Model Context Protocol)

- Ships the dev-assistant MCP server (`src/mcp/`) exposed via `opensaas mcp start` — feature wizards, docs search, migration tools
- Runtime MCP for applications lives in `@opensaas/stack-core/mcp` (handlers) and `@opensaas/stack-auth/mcp` (Better-auth adapter); the generator emits no MCP files

### With Prisma

The CLI shells to Prisma for two things and nothing else: `contract emit`, for the committed artifacts, and the reconcile and migrate commands the dev loop and a deployment run.

## Common Patterns

### Development Workflow

```bash
# One terminal. The loop starts the database, generates, reconciles and runs the app.
opensaas dev

# Edit opensaas.config.ts — generation is staged behind reconciliation and
# promoted when the plan applies.
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "opensaas dev",
    "generate": "opensaas generate",
    "db:update": "opensaas db update",
    "build": "pnpm generate && next build"
  }
}
```

### CI/CD Integration

```yaml
- run: pnpm install
- run: opensaas generate
- run: git diff --exit-code # the contract artifacts and migration spaces are committed
- run: pnpm test
```

## Error Handling

Common errors:

- Config not found → check the file exists in the working directory
- TypeScript errors in the config → fix the syntax in `opensaas.config.ts`
- Permission denied → ensure write access to `prisma/`, `migrations/` and `.opensaas/`
- A generate-time refusal → the message names the list, the entry and the fix; it is a config error, not a CLI bug

## Output Styling

Uses `chalk` and `ora` for colored, animated output:

- ✅ Green checkmarks for success
- ❌ Red X for errors
- 🚀 Emoji for branding
- Spinner animations during generation

## Migration Command

### Overview

`opensaas migrate` helps users migrate existing Prisma, KeystoneJS, or Next.js projects to OpenSaaS Stack with optional AI assistance.

**Key files:**

- `src/commands/migrate.ts` - CLI command implementation
- `src/migration/types.ts` - Shared migration types
- `src/migration/introspectors/` - Schema introspection (Prisma, Keystone, Next.js)
- `src/migration/generators/migration-generator.ts` - Config file generation
- `src/mcp/lib/wizards/migration-wizard.ts` - Interactive wizard engine

### Command Architecture

**Two modes:**

1. **Basic mode** - Project detection and analysis
2. **AI mode** (`--with-ai`) - Full Claude Code integration

### Basic Mode Workflow

```bash
opensaas migrate [--type prisma|nextjs|keystone]
```

1. **Detect project type** - Checks for:
   - Prisma: `prisma/schema.prisma`
   - KeystoneJS: `keystone.config.ts` or `keystone.ts`
   - Next.js: `next` in `package.json`

2. **Analyze schema** (Prisma only in basic mode):
   - Parse `schema.prisma` with regex
   - Count models and fields
   - Extract database provider

3. **Display summary**:
   - Project types detected
   - Model count and tree
   - Next steps

### AI Mode Workflow

```bash
opensaas migrate --with-ai
```

Includes basic mode steps plus:

4. **Setup Claude Code integration** (`setupClaudeCode` in `migrate.ts`):
   - Create `.claude/` directory
   - Write `.claude/opensaas-project.json` (project metadata: projectTypes, provider, models, hasAuth)
   - Write `.claude/settings.json` registering `opensaas-stack-marketplace` (`extraKnownMarketplaces`) and enabling `opensaas-migration@opensaas-stack-marketplace` (`enabledPlugins`)
   - Write `.claude/README.md` with a project summary

The migration agent, slash commands (`/analyze-schema`, `/generate-config`, `/validate-migration`), and skills are NOT generated — they ship statically in `claude-plugins/opensaas-migration/` and arrive via the enabled plugin. The MCP server comes from the plugin's `plugin.json` `mcpServers` entry.

### Migration Types

```typescript
export type ProjectType = 'prisma' | 'nextjs' | 'keystone'

export interface ProjectAnalysis {
  projectTypes: ProjectType[]
  cwd: string
  models?: ModelInfo[]
  provider?: string
  hasAuth?: boolean
  authLibrary?: string
}

export interface MigrationSession {
  id: string
  projectType: ProjectType
  analysis: ProjectAnalysis
  currentQuestionIndex: number
  answers: Record<string, string | boolean | string[]>
  generatedConfig?: string
  isComplete: boolean
  createdAt: Date
  updatedAt: Date
}
```

### Introspectors

**Purpose:** Deep analysis of project schemas

**Files:**

- `introspectors/prisma-introspector.ts` - Parse Prisma schema to AST
- `introspectors/keystone-introspector.ts` - Load and analyze Keystone config
- `introspectors/nextjs-introspector.ts` - Detect Next.js patterns

**Prisma Introspector:**

```typescript
export class PrismaIntrospector {
  async introspect(schemaPath: string): Promise<IntrospectedSchema> {
    // Uses @prisma/internals to parse schema
    // Returns structured model/field/relation data
    // Identifies field types, modifiers, relationships
  }
}
```

**Usage in MCP:**

```typescript
// MCP tool: opensaas_introspect_prisma
const introspector = new PrismaIntrospector()
const schema = await introspector.introspect('./prisma/schema.prisma')
// Returns: { provider, models, enums }
```

### Migration Wizard

**Purpose:** Interactive questionnaire for generating config

**File:** `src/mcp/lib/wizards/migration-wizard.ts`

**Session Management:**

```typescript
class MigrationWizard {
  private sessions: { [sessionId: string]: MigrationSession } = {}

  async startMigration(projectType, analysis): Promise<MCPResponse>
  async answerQuestion(sessionId, answer): Promise<MCPResponse>
}
```

**Question Types:**

- `text` - Free-form text input
- `select` - Single choice from options
- `boolean` - Yes/No questions
- `multiselect` - Multiple choices

**Question Flow:**

1. Database configuration (preserve existing? provider?)
2. Authentication (enable? providers?)
3. Access control (default pattern?)
4. Admin UI (mount path?)

**Dynamic Questions:**

Questions can depend on previous answers:

```typescript
{
  id: 'auth_providers',
  text: 'Which authentication providers?',
  type: 'multiselect',
  options: ['email', 'github', 'google'],
  dependsOn: {
    questionId: 'enable_auth',
    value: true
  }
}
```

### Migration Generator

**Purpose:** Convert wizard answers to `opensaas.config.ts`

**File:** `src/migration/generators/migration-generator.ts`

**Key methods:**

```typescript
class MigrationGenerator {
  async generateConfig(
    session: MigrationSession,
    schema: IntrospectedSchema,
  ): Promise<MigrationOutput> {
    // 1. Generate imports
    // 2. Convert models to lists
    // 3. Map field types
    // 4. Generate access control
    // 5. Add plugins (auth, etc.)
    // 6. Create db config
  }
}
```

**Field Type Mapping:**

| Prisma Type | OpenSaaS Field   | Import                        |
| ----------- | ---------------- | ----------------------------- |
| `String`    | `text()`         | `@opensaas/stack-core/fields` |
| `Int`       | `integer()`      | `@opensaas/stack-core/fields` |
| `Boolean`   | `checkbox()`     | `@opensaas/stack-core/fields` |
| `DateTime`  | `timestamp()`    | `@opensaas/stack-core/fields` |
| Relations   | `relationship()` | `@opensaas/stack-core/fields` |

**Access Control Patterns:**

Based on `default_access` answer:

- `"public-read-auth-write"` - Common for blogs
- `"owner-only"` - User-specific data
- `"admin-only"` - Protected resources
- `"public"` - Fully public

**Output:**

```typescript
interface MigrationOutput {
  configContent: string // opensaas.config.ts content
  dependencies: string[] // npm packages to install
  files: Array<{
    // Additional files to create
    path: string
    content: string
    language: string
    description: string
  }>
  steps: string[] // Next steps for user
  warnings: string[] // Migration warnings
}
```

### MCP Integration

**Registered MCP Tools:**

Declared in the `TOOLS` array and dispatched in `src/mcp/server/index.ts` (implementations live in `stack-mcp-server.ts`):

1. **opensaas_implement_feature** - Start a feature wizard (authentication, blog, comments, file-upload, semantic-search, custom)
2. **opensaas_answer_feature** - Answer a feature wizard question
3. **opensaas_answer_followup** - Answer a wizard follow-up question
4. **opensaas_feature_docs** - Search hosted documentation
5. **opensaas_list_features** - List available features
6. **opensaas_suggest_features** - Suggest complementary features
7. **opensaas_validate_feature** - Feature validation checklist
8. **opensaas_start_migration** - Begin migration wizard
9. **opensaas_answer_migration** - Answer migration wizard question
10. **opensaas_introspect_prisma** - Analyze Prisma schema
11. **opensaas_introspect_keystone** - Analyze Keystone config
12. **opensaas_search_migration_docs** - Search migration docs (local CLAUDE.md + hosted)
13. **opensaas_get_example** - Get example code for common patterns

**MCP Response Format:**

All tools return standardized format:

```typescript
{
  content: [
    {
      type: 'text',
      text: '# Markdown formatted response',
    },
  ]
}
```

### Claude Code Plugin Integration

The migration agent (`migration-assistant`), slash commands (`/analyze-schema`, `/generate-config`, `/validate-migration`), and skills ship statically in `claude-plugins/opensaas-migration/` — `migrate --with-ai` enables that plugin rather than generating files. The agent reads `.claude/opensaas-project.json` (written by `migrate --with-ai`) for project context.

**Agent Behavior:**

1. Start migration when user says "help me migrate"
2. Present questions naturally (hide session IDs)
3. Explain options clearly
4. Show progress throughout
5. Generate and explain config
6. Provide validation and next steps

### Common Patterns

**Project Detection:**

```typescript
async function detectProjectType(cwd: string): Promise<ProjectType[]> {
  const types: ProjectType[] = []

  if (fs.existsSync(path.join(cwd, 'prisma', 'schema.prisma'))) {
    types.push('prisma')
  }

  if (fs.existsSync(path.join(cwd, 'keystone.config.ts'))) {
    types.push('keystone')
  }

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
  if (pkg.dependencies?.next) {
    types.push('nextjs')
  }

  return types
}
```

**Schema Analysis:**

```typescript
async function analyzePrismaSchema(cwd: string) {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf-8')

  // Extract models with regex
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  const models = []
  let match

  while ((match = modelRegex.exec(schema)) !== null) {
    models.push({
      name: match[1],
      fieldCount: countFields(match[2]),
    })
  }

  // Extract provider
  const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/)
  const provider = providerMatch?.[1] || 'unknown'

  return { models, provider }
}
```

### Error Handling

**Project not detected:**

```typescript
if (projectTypes.length === 0) {
  spinner.fail('No recognizable project found')
  console.log('This command works with:')
  console.log('  - Prisma projects (prisma/schema.prisma)')
  console.log('  - KeystoneJS projects (keystone.config.ts)')
  console.log('  - Next.js projects (package.json with next)')
  process.exit(1)
}
```

**Schema analysis failure:**

```typescript
try {
  const analysis = await analyzePrismaSchema(cwd)
  // ...
} catch (error) {
  // Continue without schema details
  spinner.warn('Could not analyze schema (will create from scratch)')
}
```

### Integration with Existing Commands

**After migration:**

1. User runs `opensaas migrate --with-ai`
2. Claude generates `opensaas.config.ts`
3. User runs `opensaas generate` (existing command)
4. User runs `pnpm dev`, which starts the database, reconciles it and runs the app

**Generated files work with existing commands:**

- `opensaas.config.ts` → Input for `generate` command
- `prisma/contract.ts` and its emitted artifacts → Generated by `generate`
- `.opensaas/context.ts` → Generated by `generate`

### Development Notes

**Testing migration:**

```bash
# Create test Prisma project
cd /tmp
mkdir test-migration
cd test-migration
npm init -y
pnpm add prisma
npx prisma init

# Add sample models to prisma/schema.prisma

# Test migration
npx @opensaas/stack-cli migrate --with-ai

# Open in Claude Code and test wizard
```

**Extending introspectors:**

To add new project type:

1. Add type to `ProjectType` union in `types.ts`
2. Create introspector in `introspectors/my-type-introspector.ts`
3. Add detection logic to `detectProjectType()` in `migrate.ts`
4. Register MCP tool in `stack-mcp-server.ts`
5. Update migration generator to handle new type

**Adding wizard questions:**

Questions generated in `MigrationWizard.generateQuestions()`:

```typescript
const questions: MigrationQuestion[] = [
  {
    id: 'my_question',
    text: 'What is your preference?',
    type: 'select',
    options: ['option1', 'option2'],
    defaultValue: 'option1',
    required: true,
  },
]
```

Access answers in generator:

```typescript
const preference = session.answers.my_question
```
