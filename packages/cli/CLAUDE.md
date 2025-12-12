# @opensaas/stack-cli

Command-line tools for OpenSaas Stack providing code generation and development utilities.

## Purpose

Converts `opensaas.config.ts` into Prisma schema and TypeScript types. Provides watch mode for automatic regeneration during development.

## Key Files & Commands

### Binary (`bin/opensaas.js`)

Entry point exposing `opensaas` CLI command

### Commands (`src/commands/`)

- `generate.ts` - One-time generation
- `dev.ts` - Watch mode with automatic regeneration
- `init.ts` - Project scaffolding (future)

### Generators (`src/generator/`)

- `prisma.ts` - Generates `prisma/schema.prisma` from config
- `types.ts` - Generates `.opensaas/types.ts` TypeScript types
- `context.ts` - Generates `.opensaas/context.ts` context factory
- `mcp.ts` - Generates MCP tools metadata
- `type-patcher.ts` - Patches Prisma types for relationships

## Architecture

### Config Loading

Uses `jiti` to execute TypeScript config:

```typescript
const jiti = createJiti(import.meta.url)
const config = jiti('./opensaas.config.ts').default
```

### Generator Pipeline

1. Load config from `opensaas.config.ts`
2. Generate Prisma schema → `prisma/schema.prisma`
3. Generate TypeScript types → `.opensaas/types.ts`
4. Generate context factory → `.opensaas/context.ts`
5. Generate MCP tools (if enabled) → `.opensaas/mcp-tools.json`

### Watch Mode

Uses `chokidar` to watch `opensaas.config.ts`:

```typescript
const watcher = chokidar.watch('opensaas.config.ts')
watcher.on('change', () => runGenerator())
```

## CLI Usage

### Generate Command

```bash
opensaas generate
```

Outputs:

- `✅ Prisma schema generated`
- `✅ TypeScript types generated`
- Next steps (run `prisma generate` and `db push`)

### Dev Command

```bash
opensaas dev
```

Outputs:

- Initial generation
- `👀 Watching opensaas.config.ts for changes...`
- Auto-regenerates on file changes

## Generated Files

### Prisma Schema (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "sqlite"
}

generator client {
  provider = "prisma-client"
}

model Post {
  id String @id @default(cuid())
  title String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Note:** Prisma 7 no longer includes `url` in the schema. The database URL is passed to PrismaClient via adapters in the `prismaClientConstructor` function.

### Prisma CLI Config (`prisma.config.ts`)

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

**Purpose:** Prisma 7 requires this file at the project root for CLI commands like `prisma db push` and `prisma migrate dev` to work. This is separate from the runtime configuration.

**Key points:**

- Generated automatically by `opensaas generate`
- Requires `dotenv` package to load `.env` files
- Reads `DATABASE_URL` from environment variables
- Only used by Prisma CLI commands, not by application runtime

### Types (`.opensaas/types.ts`)

```typescript
export type Post = {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

export type PostCreateInput = {
  title: string
}

export type PostUpdateInput = {
  title?: string
}
```

### Context Factory (`.opensaas/context.ts`)

```typescript
import { createContext } from '@opensaas/stack-core'
import { PrismaClient } from '@prisma/client'
import config from '../opensaas.config'

// Prisma 7 requires adapters - PrismaClient created via prismaClientConstructor
const prisma = config.db.prismaClientConstructor(PrismaClient)

export function getContext(session?: any) {
  return createContext(config, prisma, session)
}
```

**Note:** The actual generated context is more sophisticated with async config resolution and singleton management, but this shows the core pattern.

## Integration Points

### With @opensaas/stack-core

- Imports generator functions from core
- Delegates Prisma/TS generation to field methods via core

### With @opensaas/stack-auth

- Context factory supports custom `prismaClientConstructor` for Better-auth session provider

### With MCP (Model Context Protocol)

- Generates MCP tools metadata when MCP enabled in config
- MCP functionality is now in `@opensaas/stack-core/mcp` (runtime) and `@opensaas/stack-auth/mcp` (adapter)

### With Prisma

Workflow:

1. `opensaas generate` → creates `prisma/schema.prisma` and `prisma.config.ts`
2. `npx prisma generate` → creates Prisma Client
3. `npx prisma db push` → pushes schema to database (uses `prisma.config.ts` for datasource URL)

## Common Patterns

### Development Workflow

```bash
# Terminal 1: Watch and regenerate
opensaas dev

# Terminal 2: Run Next.js
pnpm next dev

# Edit opensaas.config.ts - auto regenerates!
```

### Package.json Scripts

```json
{
  "scripts": {
    "generate": "opensaas generate",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "dev": "opensaas dev"
  }
}
```

### CI/CD Integration

```yaml
- run: pnpm install
- run: opensaas generate
- run: npx prisma generate
- run: pnpm test
```

### Custom Prisma Client (Required in Prisma 7)

**All configs must provide `prismaClientConstructor`** with a database adapter:

```typescript
// SQLite example
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const db = new Database(process.env.DATABASE_URL || './dev.db')
      const adapter = new PrismaBetterSQLite3(db)
      return new PrismaClient({ adapter })
    },
  },
})
```

```typescript
// PostgreSQL example
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  },
})
```

Generated context always uses the constructor:

```typescript
// .opensaas/context.ts
const prisma = config.db.prismaClientConstructor(PrismaClient)
```

## Type Patching

CLI patches Prisma types for relationship fields to handle access control:

- Relationships can be `null` when access denied
- Adds `| null` to relationship field types in generated types

## Error Handling

Common errors:

- Config not found → check file exists in CWD
- TypeScript errors in config → fix syntax in `opensaas.config.ts`
- Permission denied → ensure write access to `prisma/` and `.opensaas/`

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

4. **Setup Claude Code integration**:
   - Create `.claude/` directory
   - Generate `settings.json` with MCP server config
   - Generate `README.md` with project summary
   - Generate `.claude/agents/migration-assistant.md` agent
   - Generate slash commands:
     - `/analyze-schema` - Detailed schema analysis
     - `/generate-config` - Generate config file
     - `/validate-migration` - Validate configuration

5. **Template system**:
   - All generated files use template placeholders
   - `{{PROJECT_TYPES}}`, `{{PROVIDER}}`, `{{MODEL_COUNT}}`, etc.
   - Templates populated from `ProjectAnalysis` data

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
    schema: IntrospectedSchema
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

| Prisma Type | OpenSaaS Field | Import |
|------------|---------------|--------|
| `String` | `text()` | `@opensaas/stack-core/fields` |
| `Int` | `integer()` | `@opensaas/stack-core/fields` |
| `Boolean` | `checkbox()` | `@opensaas/stack-core/fields` |
| `DateTime` | `timestamp()` | `@opensaas/stack-core/fields` |
| Relations | `relationship()` | `@opensaas/stack-core/fields` |

**Access Control Patterns:**

Based on `default_access` answer:

- `"public-read-auth-write"` - Common for blogs
- `"owner-only"` - User-specific data
- `"admin-only"` - Protected resources
- `"public"` - Fully public

**Output:**

```typescript
interface MigrationOutput {
  configContent: string         // opensaas.config.ts content
  dependencies: string[]         // npm packages to install
  files: Array<{                 // Additional files to create
    path: string
    content: string
    language: string
    description: string
  }>
  steps: string[]                // Next steps for user
  warnings: string[]             // Migration warnings
}
```

### MCP Integration

**New MCP Tools:**

Registered in `src/mcp/server/stack-mcp-server.ts`:

1. **opensaas_introspect_prisma** - Analyze Prisma schema
2. **opensaas_introspect_keystone** - Analyze Keystone config
3. **opensaas_introspect_nextjs** - Analyze Next.js project
4. **opensaas_start_migration** - Begin wizard
5. **opensaas_answer_migration** - Answer wizard question
6. **opensaas_get_migration_status** - Check wizard progress
7. **opensaas_search_migration_docs** - Search migration docs
8. **opensaas_get_migration_example** - Get code examples
9. **opensaas_list_field_types** - List available field types
10. **opensaas_validate_migration** - Validate config
11. **opensaas_generate_config_file** - Write config to disk

**MCP Response Format:**

All tools return standardized format:

```typescript
{
  content: [
    {
      type: 'text',
      text: '# Markdown formatted response'
    }
  ]
}
```

### Claude Code Templates

**Generated Agent:** `.claude/agents/migration-assistant.md`

**Purpose:** Contextual agent that knows project details

**Template Variables:**

- `{{PROJECT_TYPES}}` - Detected types (e.g., "prisma, nextjs")
- `{{PROVIDER}}` - Database provider (e.g., "postgresql")
- `{{MODEL_COUNT}}` - Number of models
- `{{MODEL_DETAILS}}` - Formatted model list
- `{{PROJECT_TYPE}}` - Primary type (e.g., "Prisma")
- `{{PROJECT_TYPE_LOWER}}` - Lowercase type (e.g., "prisma")
- `{{HAS_AUTH}}` - Whether auth detected

**Agent Behavior:**

1. Start migration when user says "help me migrate"
2. Present questions naturally (hide session IDs)
3. Explain options clearly
4. Show progress throughout
5. Generate and explain config
6. Provide validation and next steps

**Generated Slash Commands:**

`.claude/commands/analyze-schema.md`:
```markdown
Analyze the current project schema and provide a detailed breakdown.

## Instructions
1. Use `opensaas_introspect_prisma` or `opensaas_introspect_keystone`
2. Present results in clear format
3. Highlight models, relations, potential access patterns
```

`.claude/commands/generate-config.md`:
```markdown
Generate the opensaas.config.ts file for this project.

## Instructions
1. Start migration wizard if not started
2. Guide through questions
3. Display generated config and dependencies
```

`.claude/commands/validate-migration.md`:
```markdown
Validate the generated opensaas.config.ts file.

## Instructions
1. Check file exists
2. Verify syntax and imports
3. Try running `opensaas generate`
4. Report errors and suggest fixes
```

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
      fieldCount: countFields(match[2])
    })
  }

  // Extract provider
  const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/)
  const provider = providerMatch?.[1] || 'unknown'

  return { models, provider }
}
```

**Template Rendering:**

```typescript
function generateTemplateContent(
  template: string,
  data: ProjectAnalysis
): string {
  return template
    .replace(/\{\{PROJECT_TYPES\}\}/g, data.projectTypes.join(', '))
    .replace(/\{\{PROVIDER\}\}/g, data.provider || 'sqlite')
    .replace(/\{\{MODEL_COUNT\}\}/g, String(data.models?.length || 0))
    .replace(/\{\{MODEL_LIST\}\}/g,
      data.models?.map(m => `- ${m.name} (${m.fieldCount} fields)`).join('\n')
    )
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
4. User runs `npx prisma db push` (Prisma)
5. User runs `pnpm dev` (Next.js)

**Generated files work with existing commands:**

- `opensaas.config.ts` → Input for `generate` command
- `.opensaas/context.ts` → Generated by `generate`
- `prisma/schema.prisma` → Generated by `generate`

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
  }
]
```

Access answers in generator:

```typescript
const preference = session.answers.my_question
```
