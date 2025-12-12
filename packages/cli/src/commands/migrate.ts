/**
 * Migration command - Helps migrate existing projects to OpenSaaS Stack
 */

import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
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
  if (fs.existsSync(prismaSchemaPath)) {
    types.push('prisma')
  }

  // Check for KeystoneJS
  const keystoneConfigPath = path.join(cwd, 'keystone.config.ts')
  const keystoneAltPath = path.join(cwd, 'keystone.ts')
  if (fs.existsSync(keystoneConfigPath) || fs.existsSync(keystoneAltPath)) {
    types.push('keystone')
  }

  // Check for Next.js
  const packageJsonPath = path.join(cwd, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
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
  const schema = fs.readFileSync(schemaPath, 'utf-8')

  // Extract models
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  const models: Array<{ name: string; fieldCount: number }> = []
  let match

  while ((match = modelRegex.exec(schema)) !== null) {
    const name = match[1]
    const body = match[2]
    const fieldCount = body
      .split('\n')
      .filter(
        (line) => line.trim() && !line.trim().startsWith('@@') && !line.trim().startsWith('//'),
      ).length
    models.push({ name, fieldCount })
  }

  // Extract provider
  const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/)
  const provider = providerMatch ? providerMatch[1] : 'unknown'

  return { models, provider }
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Generate template content with placeholders replaced
 */
function generateTemplateContent(template: string, data: ProjectAnalysis): string {
  const projectType = data.projectTypes[0] || 'unknown'
  const projectTypeLower = projectType.toLowerCase()
  const modelCount = data.models?.length || 0
  const modelList = data.models?.map((m) => `- ${m.name} (${m.fieldCount} fields)`).join('\n') || ''
  const modelDetails =
    data.models?.map((m) => `- **${m.name}**: ${m.fieldCount} fields`).join('\n') || ''

  return template
    .replace(/\{\{PROJECT_TYPES\}\}/g, data.projectTypes.join(', '))
    .replace(/\{\{PROJECT_TYPE\}\}/g, projectType)
    .replace(/\{\{PROJECT_TYPE_LOWER\}\}/g, projectTypeLower)
    .replace(/\{\{PROVIDER\}\}/g, data.provider || 'sqlite')
    .replace(/\{\{MODEL_COUNT\}\}/g, String(modelCount))
    .replace(/\{\{HAS_AUTH\}\}/g, String(data.hasAuth || false))
    .replace(/\{\{MODEL_LIST\}\}/g, modelList)
    .replace(/\{\{MODEL_DETAILS\}\}/g, modelDetails)
}

/**
 * Setup Claude Code integration
 */
async function setupClaudeCode(cwd: string, analysis: ProjectAnalysis): Promise<void> {
  const claudeDir = path.join(cwd, '.claude')
  const agentsDir = path.join(claudeDir, 'agents')
  const commandsDir = path.join(claudeDir, 'commands')
  const skillsDir = path.join(claudeDir, 'skills')
  const migrationSkillDir = path.join(skillsDir, 'opensaas-migration')

  // Create directories
  ensureDir(agentsDir)
  ensureDir(commandsDir)
  ensureDir(migrationSkillDir)

  // Create .mcp.json at project root (project-scoped MCP configuration)
  const mcpConfig = {
    mcpServers: {
      'opensaas-migration': {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@opensaas/stack-cli', 'mcp', 'start'],
        env: {},
      },
    },
  }
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify(mcpConfig, null, 2))

  // Create README template
  const readmeTemplate = `# OpenSaaS Stack Migration

This project is being migrated to OpenSaaS Stack.

## Project Summary

- **Project Type:** {{PROJECT_TYPES}}
- **Database Provider:** {{PROVIDER}}
- **Models Detected:** {{MODEL_COUNT}}

### Models

{{MODEL_LIST}}

## Quick Start

Ask Claude: **"Help me migrate to OpenSaaS Stack"**

Claude will guide you through:
1. Reviewing your current schema
2. Configuring access control
3. Setting up authentication (optional)
4. Generating \`opensaas.config.ts\`

## Claude Code Setup

This project is configured for Claude Code with:

### Migration Assistant Agent
A specialized agent (\`migration-assistant\`) that automatically helps with:
- Analyzing your schema
- Configuring access control
- Generating opensaas.config.ts
- Answering migration questions

The agent will activate automatically when you ask migration-related questions.

### Migration Skill
The \`opensaas-migration\` skill provides expert knowledge including:
- Access control patterns
- Field type mappings
- Database configuration examples
- Migration best practices

### MCP Server
The \`.mcp.json\` file configures the OpenSaaS migration MCP server which provides:
- Schema analysis tools
- Interactive migration wizard
- Documentation search
- Code generation assistance

When you open this project in Claude Code, you may be prompted to approve the MCP server.

To manually manage the MCP server:
\`\`\`bash
# List MCP servers
claude mcp list

# Get details
claude mcp get opensaas-migration
\`\`\`

## Available Commands

| Command | Description |
|---------|-------------|
| \`/analyze-schema\` | View detailed schema analysis |
| \`/generate-config\` | Generate the config file |
| \`/validate-migration\` | Validate generated config |

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
- [GitHub Repository](https://github.com/OpenSaasAU/stack)

## Generated By

This migration was set up using:
\`\`\`bash
npx @opensaas/stack-cli migrate --with-ai
\`\`\`
`

  fs.writeFileSync(
    path.join(claudeDir, 'README.md'),
    generateTemplateContent(readmeTemplate, analysis),
  )

  // Create migration assistant agent template
  const agentTemplate = `---
name: migration-assistant
description: OpenSaaS Stack migration expert. Use when helping users migrate from Prisma, KeystoneJS, or Next.js projects to OpenSaaS Stack. Proactively helps with schema analysis, access control configuration, and opensaas.config.ts generation.
model: sonnet
skills: opensaas-migration
---

You are the OpenSaaS Stack Migration Assistant, helping users migrate their existing projects to OpenSaaS Stack.

## Project Context

**Project Type:** {{PROJECT_TYPES}}
**Database Provider:** {{PROVIDER}}
**Total Models:** {{MODEL_COUNT}}

### Detected Models

{{MODEL_DETAILS}}

## Your Role

Guide the user through a complete migration to OpenSaaS Stack:

1. **Analyze** their current project structure
2. **Explain** what OpenSaaS Stack offers (access control, admin UI, type safety)
3. **Guide** them through the migration wizard
4. **Generate** a working \`opensaas.config.ts\`
5. **Validate** the generated configuration
6. **Provide** clear next steps

## Available MCP Tools

### Schema Analysis
- \`opensaas_introspect_prisma\` - Analyze Prisma schema in detail
- \`opensaas_introspect_keystone\` - Analyze KeystoneJS config

### Migration Wizard
- \`opensaas_start_migration\` - Start the interactive wizard
- \`opensaas_answer_migration\` - Answer wizard questions

### Documentation
- \`opensaas_search_migration_docs\` - Search migration documentation
- \`opensaas_get_example\` - Get example code patterns

### Validation
- \`opensaas_validate_feature\` - Validate implementation

## Conversation Guidelines

### When the user says "help me migrate" or similar:

1. **Acknowledge** their project:
   > "I can see you have a {{PROJECT_TYPE}} project with {{MODEL_COUNT}} models. Let me help you migrate to OpenSaaS Stack!"

2. **Start the wizard** by calling:
   \`\`\`
   opensaas_start_migration({ projectType: "{{PROJECT_TYPE_LOWER}}" })
   \`\`\`

3. **Present questions naturally** - don't mention session IDs or technical details to the user

4. **Explain choices** - help them understand what each option means:
   - Access control patterns
   - Authentication options
   - Database configuration

5. **Show progress** - let them know how far along they are

6. **Generate the config** when complete and explain what was created

### When explaining OpenSaaS Stack:

Highlight these benefits:
- **Built-in access control** - Secure by default
- **Admin UI** - Auto-generated from your schema
- **Type safety** - Full TypeScript support
- **Prisma integration** - Uses familiar ORM
- **Plugin system** - Easy to extend

### When answering questions:

- Use \`opensaas_search_migration_docs\` to find accurate information
- Use \`opensaas_get_example\` to show code patterns
- Be honest if something isn't supported

### Tone

- Be encouraging and helpful
- Explain technical concepts simply
- Celebrate progress ("Great choice!", "Almost there!")
- Don't overwhelm with information

## Example Conversation

**User:** Help me migrate to OpenSaaS Stack

**You:** I can see you have a {{PROJECT_TYPE}} project with {{MODEL_COUNT}} models. OpenSaaS Stack will give you:

- Automatic admin UI for managing your data
- Built-in access control to secure your API
- Type-safe database operations

Let me start the migration wizard to configure your project...

[Call opensaas_start_migration]

**User:** [answers questions]

**You:** [Continue through wizard, explain each choice, generate final config]

## Error Handling

If something goes wrong:
1. Explain what happened in simple terms
2. Suggest alternatives or manual steps
3. Link to documentation for more help

## After Migration

Once the config is generated, guide them through:
1. Installing dependencies
2. Running \`opensaas generate\`
3. Running \`prisma db push\`
4. Starting their dev server
5. Visiting the admin UI
`

  fs.writeFileSync(
    path.join(agentsDir, 'migration-assistant.md'),
    generateTemplateContent(agentTemplate, analysis),
  )

  // Create analyze-schema command
  const analyzeSchemaTemplate = `Analyze the current project schema and provide a detailed breakdown.

## Instructions

1. Use \`opensaas_introspect_prisma\` or \`opensaas_introspect_keystone\` based on project type
2. Present the results in a clear, organized format
3. Highlight:
   - All models and their fields
   - Relationships between models
   - Potential access control patterns
   - Any issues or warnings

## Output Format

Present like this:

### Models Summary

| Model | Fields | Has Relations | Suggested Access |
|-------|--------|---------------|------------------|
| ... | ... | ... | ... |

### Detailed Analysis

[For each model, show fields and relationships]

### Recommendations

[Based on the schema, suggest access control patterns]
`

  fs.writeFileSync(path.join(commandsDir, 'analyze-schema.md'), analyzeSchemaTemplate)

  // Create generate-config command
  const generateConfigTemplate = `Generate the opensaas.config.ts file for this project.

## Instructions

1. If migration wizard hasn't been started, start it:
   \`\`\`
   opensaas_start_migration({ projectType: "{{PROJECT_TYPE_LOWER}}" })
   \`\`\`

2. Guide the user through any remaining questions

3. When complete, display:
   - The generated config file
   - Dependencies to install
   - Next steps to run

4. Offer to explain any part of the generated config

## Quick Mode

If the user wants defaults, use these answers:
- preserve_database: true
- db_provider: {{PROVIDER}}
- enable_auth: {{HAS_AUTH}}
- default_access: "public-read-auth-write"
- admin_base_path: "/admin"
`

  fs.writeFileSync(
    path.join(commandsDir, 'generate-config.md'),
    generateTemplateContent(generateConfigTemplate, analysis),
  )

  // Create validate-migration command
  const validateMigrationTemplate = `Validate the generated opensaas.config.ts file.

## Instructions

1. Check if opensaas.config.ts exists in the project root

2. If it exists, verify:
   - Syntax is valid TypeScript
   - All imports are correct
   - Database config is complete
   - Lists match original schema

3. Try running:
   \`\`\`bash
   npx @opensaas/stack-cli generate
   \`\`\`

4. Report any errors and suggest fixes

5. If validation passes, confirm next steps:
   - \`npx prisma generate\`
   - \`npx prisma db push\`
   - \`pnpm dev\`

## Common Issues

- Missing dependencies → suggest \`pnpm add ...\`
- Database URL not set → remind about .env file
- Type errors → suggest specific fixes
`

  fs.writeFileSync(path.join(commandsDir, 'validate-migration.md'), validateMigrationTemplate)

  // Create migration skill
  const migrationSkillTemplate = `---
name: opensaas-migration
description: Expert knowledge for migrating projects to OpenSaaS Stack. Use when discussing migration strategies, access control patterns, or OpenSaaS Stack configuration best practices.
---

# OpenSaaS Stack Migration

Expert guidance for migrating existing projects to OpenSaaS Stack.

## When to Use This Skill

Use this skill when:
- Planning a migration from Prisma, KeystoneJS, or Next.js
- Designing access control patterns
- Configuring \`opensaas.config.ts\`
- Troubleshooting migration issues
- Explaining OpenSaaS Stack concepts

## Migration Process

### 1. Schema Analysis

**Prisma Projects:**
- Analyze existing \`schema.prisma\`
- Identify models, fields, and relationships
- Note any Prisma-specific features used

**KeystoneJS Projects:**
- Review list definitions
- Map KeystoneJS fields to OpenSaaS fields
- Identify access control patterns

### 2. Access Control Design

**Common Patterns:**

\`\`\`typescript
// Public read, authenticated write
operation: {
  query: () => true,
  create: ({ session }) => !!session?.userId,
  update: ({ session }) => !!session?.userId,
  delete: ({ session }) => !!session?.userId,
}

// Author-only access
operation: {
  query: () => true,
  update: ({ session, item }) => item.authorId === session?.userId,
  delete: ({ session, item }) => item.authorId === session?.userId,
}

// Admin-only
operation: {
  query: ({ session }) => session?.role === 'admin',
  create: ({ session }) => session?.role === 'admin',
  update: ({ session }) => session?.role === 'admin',
  delete: ({ session }) => session?.role === 'admin',
}

// Filter-based access
operation: {
  query: ({ session }) => ({
    where: { authorId: { equals: session?.userId } }
  }),
}
\`\`\`

### 3. Field Mapping

**Prisma to OpenSaaS:**

| Prisma Type | OpenSaaS Field |
|-------------|----------------|
| \`String\` | \`text()\` |
| \`Int\` | \`integer()\` |
| \`Boolean\` | \`checkbox()\` |
| \`DateTime\` | \`timestamp()\` |
| \`Enum\` | \`select({ options: [...] })\` |
| \`Relation\` | \`relationship({ ref: '...' })\` |

**KeystoneJS to OpenSaaS:**

| KeystoneJS Field | OpenSaaS Field |
|------------------|----------------|
| \`text\` | \`text()\` |
| \`integer\` | \`integer()\` |
| \`checkbox\` | \`checkbox()\` |
| \`timestamp\` | \`timestamp()\` |
| \`select\` | \`select()\` |
| \`relationship\` | \`relationship()\` |
| \`password\` | \`password()\` |

### 4. Database Configuration

**SQLite (Development):**
\`\`\`typescript
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

export default config({
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
\`\`\`

**PostgreSQL (Production):**
\`\`\`typescript
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default config({
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
\`\`\`

## Common Migration Challenges

### Challenge: Preserving Existing Data

**Solution:**
- Use \`opensaas generate\` to create Prisma schema
- Use \`prisma db push\` instead of migrations for existing databases
- Never use \`prisma migrate dev\` with existing data

### Challenge: Complex Access Control

**Solution:**
- Start with simple boolean access control
- Iterate to filter-based access as needed
- Use field-level access for sensitive data

### Challenge: Custom Field Types

**Solution:**
- Create custom field builders extending \`BaseFieldConfig\`
- Implement \`getZodSchema\`, \`getPrismaType\`, \`getTypeScriptType\`
- Register UI components for admin interface

## Migration Checklist

- [ ] Analyze existing schema
- [ ] Design access control patterns
- [ ] Create \`opensaas.config.ts\`
- [ ] Configure database adapter
- [ ] Run \`opensaas generate\`
- [ ] Run \`prisma generate\`
- [ ] Run \`prisma db push\`
- [ ] Test access control
- [ ] Verify admin UI
- [ ] Update application code to use context
- [ ] Test all CRUD operations
- [ ] Deploy to production

## Best Practices

1. **Start Simple**: Begin with basic access control, refine later
2. **Test Access Control**: Verify permissions work as expected
3. **Use Context Everywhere**: Replace direct Prisma calls with \`context.db\`
4. **Leverage Plugins**: Use \`@opensaas/stack-auth\` for authentication
5. **Version Control**: Commit \`opensaas.config.ts\` to git
6. **Document Decisions**: Comment complex access control logic

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
- [Access Control Guide](https://stack.opensaas.au/core-concepts/access-control)
- [Field Types](https://stack.opensaas.au/core-concepts/field-types)
`

  fs.writeFileSync(
    path.join(migrationSkillDir, 'SKILL.md'),
    generateTemplateContent(migrationSkillTemplate, analysis),
  )
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
    } catch (_error) {
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
      console.log(chalk.dim('   ├─ Generated migration-assistant agent'))
      console.log(chalk.dim('   ├─ Created opensaas-migration skill'))
      console.log(chalk.dim('   ├─ Created .mcp.json (project MCP config)'))
      console.log(chalk.dim('   └─ Registered opensaas-migration MCP server'))
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
