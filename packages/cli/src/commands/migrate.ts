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
 * Setup Claude Code integration
 */
async function setupClaudeCode(cwd: string, analysis: ProjectAnalysis): Promise<void> {
  const claudeDir = path.join(cwd, '.claude')
  const agentsDir = path.join(claudeDir, 'agents')
  const commandsDir = path.join(claudeDir, 'commands')

  // Create directories
  ensureDir(agentsDir)
  ensureDir(commandsDir)

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
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2))

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
  fs.writeFileSync(path.join(claudeDir, 'README.md'), readme)

  // Create migration assistant agent
  const modelList =
    analysis.models?.map((m) => `- ${m.name} (${m.fieldCount} fields)`).join('\n') ||
    'No models detected'

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
  fs.writeFileSync(path.join(agentsDir, 'migration-assistant.md'), agentPrompt)

  // Create command files
  const analyzeCommand = `Analyze the current project schema and show details about:
- All models/tables and their fields
- Relationships between models
- Database provider and connection
- Potential access control patterns

Use the \`opensaas_introspect_prisma\` or \`opensaas_introspect_keystone\` tools.
`
  fs.writeFileSync(path.join(commandsDir, 'analyze-schema.md'), analyzeCommand)

  const generateCommand = `Generate the opensaas.config.ts file based on the current schema analysis.

This should:
1. Start the migration wizard if not already started
2. Use sensible defaults where possible
3. Generate a complete, working config
4. Show the user what was generated
5. Provide next steps

Use the migration wizard tools to complete this.
`
  fs.writeFileSync(path.join(commandsDir, 'generate-config.md'), generateCommand)
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
