# Phase 1: CLI Migration Command

## Task Overview

Create the `opensaas migrate` CLI command that detects project types, analyzes existing schemas, and sets up Claude Code integration for AI-guided migration.

## Context

### OpenSaaS Stack CLI Architecture

The CLI is built with Commander.js and located in `packages/cli/`. The main entry point is `packages/cli/src/index.ts`:

```typescript
#!/usr/bin/env node

import { Command } from 'commander'
import { generateCommand } from './commands/generate.js'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'
import { createMCPCommand } from './commands/mcp.js'

const program = new Command()

program.name('opensaas').description('OpenSaas Stack CLI').version('0.1.0')

program
  .command('generate')
  .description('Generate Prisma schema and TypeScript types from opensaas.config.ts')
  .action(async () => {
    await generateCommand()
  })

program
  .command('init [project-name]')
  .description('Create a new OpenSaas project (delegates to create-opensaas-app)')
  .option('--with-auth', 'Include authentication (Better-auth)')
  .allowUnknownOption()
  .action(async (projectName, options) => {
    const args = []
    if (projectName) args.push(projectName)
    if (options.withAuth) args.push('--with-auth')
    await initCommand(args)
  })

program
  .command('dev')
  .description('Watch opensaas.config.ts and regenerate on changes')
  .action(async () => {
    await devCommand()
  })

// Add MCP command group
program.addCommand(createMCPCommand())

program.parse()
```

### Existing MCP Command Pattern

Reference `packages/cli/src/commands/mcp.ts` for command structure:

```typescript
import { Command } from 'commander'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function createMCPCommand(): Command {
  const mcp = new Command('mcp')
  mcp.description('MCP server for AI-assisted development with Claude Code')

  mcp
    .command('install')
    .description('Install MCP server in Claude Code')
    .action(async () => {
      try {
        await installMCPServer()
        process.exit(0)
      } catch {
        process.exit(1)
      }
    })

  // ... more subcommands

  return mcp
}
```

### Output Styling

Use `chalk` and `ora` for consistent styling:
- ✅ Green checkmarks for success
- ❌ Red X for errors
- 📦 📊 📁 🤖 Emoji prefixes
- Spinner animations during async operations

---

## Requirements

### 1. Create Migration Command

**File to create:** `packages/cli/src/commands/migrate.ts`

The command should:

1. **Auto-detect project type** by checking for:
   - `prisma/schema.prisma` → Prisma project
   - `keystone.config.ts` or `keystone.ts` → KeystoneJS project
   - `package.json` with `next` dependency → Next.js project
   - Can be multiple (e.g., Prisma + Next.js)

2. **Analyze project structure**:
   - Count models/lists in schema
   - Detect database provider
   - Identify existing auth patterns

3. **Setup Claude Code integration** (when `--with-ai` flag):
   - Create `.claude/` directory structure
   - Generate `settings.json` with MCP server registration
   - Create migration assistant agent file
   - Create command files

4. **Display analysis and next steps**

### 2. Create Migration Types

**File to create:** `packages/cli/src/migration/types.ts`

Define shared types for the migration system.

### 3. Modify CLI Entry Point

**File to modify:** `packages/cli/src/index.ts`

Add the migrate command to the CLI.

---

## File Templates

### `packages/cli/src/commands/migrate.ts`

```typescript
/**
 * Migration command - Helps migrate existing projects to OpenSaaS Stack
 */

import { Command } from 'commander'
import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { spawn } from 'child_process'
import type { ProjectAnalysis, ProjectType } from '../migration/types.js'

interface MigrateOptions {
  withAi?: boolean
  type?: 'prisma' | 'nextjs' | 'keystone'
}

/**
 * Detect what type of project this is
 */
async function detectProjectType(cwd: string): Promise<ProjectType[]> {
  const types: ProjectType[] = []

  // Check for Prisma
  const prismaSchemaPath = path.join(cwd, 'prisma', 'schema.prisma')
  if (await fs.pathExists(prismaSchemaPath)) {
    types.push('prisma')
  }

  // Check for KeystoneJS
  const keystoneConfigPath = path.join(cwd, 'keystone.config.ts')
  const keystoneAltPath = path.join(cwd, 'keystone.ts')
  if (await fs.pathExists(keystoneConfigPath) || await fs.pathExists(keystoneAltPath)) {
    types.push('keystone')
  }

  // Check for Next.js
  const packageJsonPath = path.join(cwd, 'package.json')
  if (await fs.pathExists(packageJsonPath)) {
    const pkg = await fs.readJSON(packageJsonPath)
    if (pkg.dependencies?.next || pkg.devDependencies?.next) {
      types.push('nextjs')
    }
  }

  return types
}

/**
 * Analyze a Prisma schema
 */
async function analyzePrismaSchema(cwd: string): Promise<{
  models: Array<{ name: string; fieldCount: number }>
  provider: string
}> {
  const schemaPath = path.join(cwd, 'prisma', 'schema.prisma')
  const schema = await fs.readFile(schemaPath, 'utf-8')

  // Extract models
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  const models: Array<{ name: string; fieldCount: number }> = []
  let match

  while ((match = modelRegex.exec(schema)) !== null) {
    const name = match[1]
    const body = match[2]
    const fieldCount = body.split('\n').filter(line =>
      line.trim() && !line.trim().startsWith('@@') && !line.trim().startsWith('//')
    ).length
    models.push({ name, fieldCount })
  }

  // Extract provider
  const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/)
  const provider = providerMatch ? providerMatch[1] : 'unknown'

  return { models, provider }
}

/**
 * Setup Claude Code integration
 */
async function setupClaudeCode(
  cwd: string,
  analysis: ProjectAnalysis
): Promise<void> {
  const claudeDir = path.join(cwd, '.claude')
  const agentsDir = path.join(claudeDir, 'agents')
  const commandsDir = path.join(claudeDir, 'commands')

  // Create directories
  await fs.ensureDir(agentsDir)
  await fs.ensureDir(commandsDir)

  // Create settings.json
  const settings = {
    mcpServers: {
      'opensaas-migration': {
        command: 'npx',
        args: ['@opensaas/stack-cli', 'mcp', 'start'],
        disabled: false,
      },
    },
  }
  await fs.writeJSON(path.join(claudeDir, 'settings.json'), settings, { spaces: 2 })

  // Create README
  const readme = `# OpenSaaS Stack Migration

This project is being migrated to OpenSaaS Stack.

## Quick Start

Ask Claude: "Help me migrate to OpenSaaS Stack"

## Project Analysis

- **Project Type**: ${analysis.projectTypes.join(', ')}
- **Models Detected**: ${analysis.models?.length || 0}
- **Database Provider**: ${analysis.provider || 'unknown'}

## Available Commands

- \`/analyze-schema\` - Re-analyze current schema
- \`/generate-config\` - Generate opensaas.config.ts

## Documentation

- [OpenSaaS Stack Docs](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
`
  await fs.writeFile(path.join(claudeDir, 'README.md'), readme)

  // Create migration assistant agent
  const modelList = analysis.models?.map(m => `- ${m.name} (${m.fieldCount} fields)`).join('\n') || 'No models detected'

  const agentPrompt = `You are the OpenSaaS Stack Migration Assistant.

## Project Analysis

**Project Type:** ${analysis.projectTypes.join(', ')}
**Database Provider:** ${analysis.provider || 'Not detected'}
**Models Detected:** ${analysis.models?.length || 0}

${modelList}

## Your Role

Guide the user through migrating this project to OpenSaaS Stack:

1. Start with \`opensaas_start_migration\` to begin the wizard
2. Answer questions about access control, authentication, etc.
3. Generate the final config with \`opensaas_generate_config\`
4. Provide clear next steps

## Available MCP Tools

- \`opensaas_start_migration\` - Begin the migration wizard
- \`opensaas_answer_migration\` - Answer wizard questions
- \`opensaas_introspect_prisma\` - View current Prisma schema
- \`opensaas_introspect_keystone\` - View KeystoneJS config
- \`opensaas_search_migration_docs\` - Search migration documentation
- \`opensaas_get_example\` - Get example code patterns

## Conversation Guidelines

When the user asks to migrate:
1. Acknowledge their project details (already analyzed above)
2. Start the migration wizard
3. Guide them through each question naturally
4. Explain the implications of each choice
5. Generate the final config with clear explanations
6. Provide next steps (install deps, generate, db:push)

Be encouraging and explain OpenSaaS Stack benefits as you go.
`
  await fs.writeFile(path.join(agentsDir, 'migration-assistant.md'), agentPrompt)

  // Create command files
  const analyzeCommand = `Analyze the current project schema and show details about:
- All models/tables and their fields
- Relationships between models
- Database provider and connection
- Potential access control patterns

Use the \`opensaas_introspect_prisma\` or \`opensaas_introspect_keystone\` tools.
`
  await fs.writeFile(path.join(commandsDir, 'analyze-schema.md'), analyzeCommand)

  const generateCommand = `Generate the opensaas.config.ts file based on the current schema analysis.

This should:
1. Start the migration wizard if not already started
2. Use sensible defaults where possible
3. Generate a complete, working config
4. Show the user what was generated
5. Provide next steps

Use the migration wizard tools to complete this.
`
  await fs.writeFile(path.join(commandsDir, 'generate-config.md'), generateCommand)
}

/**
 * Main migrate command
 */
async function migrateCommand(options: MigrateOptions): Promise<void> {
  const cwd = process.cwd()

  console.log(chalk.bold.cyan('\n🚀 OpenSaaS Stack Migration\n'))

  // Step 1: Detect project type
  const spinner = ora('Detecting project type...').start()

  let projectTypes: ProjectType[]
  if (options.type) {
    projectTypes = [options.type]
  } else {
    projectTypes = await detectProjectType(cwd)
  }

  if (projectTypes.length === 0) {
    spinner.fail(chalk.red('No recognizable project found'))
    console.log(chalk.dim('\nThis command works with:'))
    console.log(chalk.dim('  - Prisma projects (prisma/schema.prisma)'))
    console.log(chalk.dim('  - KeystoneJS projects (keystone.config.ts)'))
    console.log(chalk.dim('  - Next.js projects (package.json with next)'))
    console.log(chalk.dim('\nUse --type to force a project type.'))
    process.exit(1)
  }

  spinner.succeed(chalk.green(`Detected: ${projectTypes.join(', ')}`))

  // Step 2: Analyze schema
  const analysisSpinner = ora('Analyzing schema...').start()

  const analysis: ProjectAnalysis = {
    projectTypes,
    cwd,
  }

  if (projectTypes.includes('prisma')) {
    try {
      const prismaAnalysis = await analyzePrismaSchema(cwd)
      analysis.models = prismaAnalysis.models
      analysis.provider = prismaAnalysis.provider
    } catch (error) {
      // Prisma analysis failed, continue without it
    }
  }

  if (analysis.models && analysis.models.length > 0) {
    analysisSpinner.succeed(chalk.green(`Found ${analysis.models.length} models`))

    // Display model tree
    const lastIndex = analysis.models.length - 1
    analysis.models.forEach((model, index) => {
      const prefix = index === lastIndex ? '└─' : '├─'
      console.log(chalk.dim(`   ${prefix} ${model.name} (${model.fieldCount} fields)`))
    })
  } else {
    analysisSpinner.succeed(chalk.yellow('No models found (will create from scratch)'))
  }

  // Step 3: Setup Claude Code (if --with-ai)
  if (options.withAi) {
    const claudeSpinner = ora('Setting up Claude Code...').start()

    try {
      await setupClaudeCode(cwd, analysis)
      claudeSpinner.succeed(chalk.green('Claude Code ready'))

      console.log(chalk.dim('   ├─ Created .claude directory'))
      console.log(chalk.dim('   ├─ Generated migration assistant'))
      console.log(chalk.dim('   └─ Registered MCP server'))
    } catch (error) {
      claudeSpinner.fail(chalk.red('Failed to setup Claude Code'))
      console.error(error)
    }
  }

  // Step 4: Display next steps
  console.log(chalk.green('\n✅ Analysis complete!\n'))

  if (options.withAi) {
    console.log(chalk.bold('🤖 Next Steps:\n'))
    console.log(chalk.cyan('   1. Open this project in Claude Code'))
    console.log(chalk.cyan('   2. Ask: "Help me migrate to OpenSaaS Stack"'))
    console.log(chalk.cyan('   3. Follow the interactive wizard'))
  } else {
    console.log(chalk.bold('📝 Next Steps:\n'))
    console.log(chalk.cyan('   1. Run with --with-ai for AI-guided migration'))
    console.log(chalk.cyan('   2. Or manually create opensaas.config.ts'))
    console.log(chalk.dim('\n   See: https://stack.opensaas.au/guides/migration'))
  }

  console.log(chalk.dim(`\n📚 Documentation: https://stack.opensaas.au/guides/migration\n`))
}

/**
 * Create the migrate command for Commander
 */
export function createMigrateCommand(): Command {
  const migrate = new Command('migrate')
  migrate.description('Migrate an existing project to OpenSaaS Stack')

  migrate
    .option('--with-ai', 'Enable AI-guided migration with Claude Code')
    .option('--type <type>', 'Force project type (prisma, nextjs, keystone)')
    .action(async (options: MigrateOptions) => {
      try {
        await migrateCommand(options)
        process.exit(0)
      } catch (error) {
        console.error(chalk.red('\n❌ Migration failed:'), error)
        process.exit(1)
      }
    })

  return migrate
}
```

### `packages/cli/src/migration/types.ts`

```typescript
/**
 * Migration types - Shared types for the migration system
 */

export type ProjectType = 'prisma' | 'nextjs' | 'keystone'

export interface ModelInfo {
  name: string
  fieldCount: number
}

export interface ProjectAnalysis {
  projectTypes: ProjectType[]
  cwd: string
  models?: ModelInfo[]
  provider?: string
  hasAuth?: boolean
  authLibrary?: string
}

export interface FieldMapping {
  prismaType: string
  opensaasType: string
  opensaasImport: string
}

export interface MigrationQuestion {
  id: string
  text: string
  type: 'text' | 'select' | 'boolean' | 'multiselect'
  options?: string[]
  defaultValue?: string | boolean | string[]
  required?: boolean
  dependsOn?: {
    questionId: string
    value: string | boolean
  }
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

export interface MigrationOutput {
  configContent: string
  dependencies: string[]
  files: Array<{
    path: string
    content: string
    language: string
    description: string
  }>
  steps: string[]
  warnings: string[]
}

export interface IntrospectedModel {
  name: string
  fields: IntrospectedField[]
  hasRelations: boolean
  primaryKey: string
}

export interface IntrospectedField {
  name: string
  type: string
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  isList: boolean
  defaultValue?: string
  relation?: {
    name: string
    model: string
    fields: string[]
    references: string[]
  }
}

export interface IntrospectedSchema {
  provider: string
  models: IntrospectedModel[]
  enums: Array<{ name: string; values: string[] }>
}
```

### Modify `packages/cli/src/index.ts`

Add to imports:

```typescript
import { createMigrateCommand } from './commands/migrate.js'
```

Add before `program.parse()`:

```typescript
// Add migrate command
program.addCommand(createMigrateCommand())
```

---

## Dependencies

Add to `packages/cli/package.json` if not present:

```json
{
  "dependencies": {
    "fs-extra": "^11.2.0"
  },
  "devDependencies": {
    "@types/fs-extra": "^11.0.4"
  }
}
```

Note: `chalk`, `ora`, and `commander` should already be present.

---

## Acceptance Criteria

1. **Command Registration**
   - [ ] `opensaas migrate` command is available
   - [ ] `opensaas migrate --help` shows options
   - [ ] `--with-ai` and `--type` flags work

2. **Project Detection**
   - [ ] Detects Prisma projects (looks for `prisma/schema.prisma`)
   - [ ] Detects KeystoneJS projects (looks for `keystone.config.ts`)
   - [ ] Detects Next.js projects (checks package.json)
   - [ ] Can detect multiple types in same project
   - [ ] `--type` flag overrides detection

3. **Schema Analysis**
   - [ ] Counts models in Prisma schema
   - [ ] Extracts field counts per model
   - [ ] Detects database provider
   - [ ] Handles missing/empty schemas gracefully

4. **Claude Code Setup (with --with-ai)**
   - [ ] Creates `.claude/` directory structure
   - [ ] Generates valid `settings.json` with MCP server
   - [ ] Creates `migration-assistant.md` agent with project details
   - [ ] Creates command files (`analyze-schema.md`, `generate-config.md`)
   - [ ] README includes project analysis summary

5. **Output Quality**
   - [ ] Uses emoji prefixes consistently
   - [ ] Shows spinner during async operations
   - [ ] Displays tree-style model list
   - [ ] Provides clear next steps
   - [ ] Links to documentation

---

## Testing

Create new vitest tests in `packages/cli/tests/commands/migrate.test.ts` to cover:
- Project type detection logic
- Schema analysis functions
- Claude Code setup functions

### Manual Testing

```bash
# Build the CLI
cd packages/cli
pnpm build

# Test on a Prisma project
cd /path/to/prisma-project
npx @opensaas/stack-cli migrate

# Test with AI setup
npx @opensaas/stack-cli migrate --with-ai

# Test type override
npx @opensaas/stack-cli migrate --type prisma

# Verify .claude directory was created correctly
ls -la .claude/
cat .claude/settings.json
cat .claude/agents/migration-assistant.md
```

### Edge Cases to Test

1. Empty directory (no project detected)
2. Project with only package.json (no Prisma)
3. Prisma project with empty schema
4. Project already has `.claude/` directory
5. Permission errors on file creation
