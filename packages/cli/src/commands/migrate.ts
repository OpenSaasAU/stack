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
 * Get plugin source path (relative to CLI package)
 */
function getPluginSourcePath(): string {
  // This will be the path to the plugin directory within the installed CLI package
  const cliPackageDir = path.dirname(path.dirname(new URL(import.meta.url).pathname))
  return path.join(cliPackageDir, 'plugin')
}

/**
 * Setup Claude Code integration with plugin
 */
async function setupClaudeCode(cwd: string, analysis: ProjectAnalysis): Promise<void> {
  const claudeDir = path.join(cwd, '.claude')

  // Create .claude directory
  ensureDir(claudeDir)

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

  // Write project metadata file for the plugin to read
  const projectMetadata = {
    projectTypes: analysis.projectTypes,
    provider: analysis.provider || 'sqlite',
    models: analysis.models || [],
    hasAuth: analysis.hasAuth || false,
    cwd: analysis.cwd,
  }
  fs.writeFileSync(
    path.join(claudeDir, 'opensaas-project.json'),
    JSON.stringify(projectMetadata, null, 2),
  )

  // Configure Claude Code plugin in settings.json
  const settingsPath = path.join(claudeDir, 'settings.json')
  let settings: any = {}

  // Read existing settings if they exist
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    } catch {
      // If settings file is invalid, start fresh
      settings = {}
    }
  }

  // Get the plugin source path
  const pluginSource = getPluginSourcePath()

  // Add plugin configuration
  if (!settings.plugins) {
    settings.plugins = {}
  }
  if (!settings.plugins.installed) {
    settings.plugins.installed = []
  }

  // Check if plugin is already installed
  const pluginId = 'opensaas-migration@local'
  const isInstalled = settings.plugins.installed.some((p: any) =>
    typeof p === 'string' ? p === pluginId : p.id === pluginId,
  )

  if (!isInstalled) {
    settings.plugins.installed.push({
      id: pluginId,
      source: pluginSource,
      enabled: true,
    })
  }

  // Write settings back
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

  // Create a simple README explaining the setup
  const readmeContent = `# OpenSaaS Stack Migration

This project is set up for AI-assisted migration to OpenSaaS Stack.

## Project Summary

- **Project Types:** ${analysis.projectTypes.join(', ')}
- **Database Provider:** ${analysis.provider || 'Not detected'}
- **Models Detected:** ${analysis.models?.length || 0}

${
  analysis.models && analysis.models.length > 0
    ? `\n### Models\n\n${analysis.models.map((m) => `- ${m.name} (${m.fieldCount} fields)`).join('\n')}`
    : ''
}

## Quick Start

Ask Claude: **"Help me migrate to OpenSaaS Stack"**

Claude will guide you through:
1. Reviewing your current schema
2. Configuring access control
3. Setting up authentication (optional)
4. Generating \`opensaas.config.ts\`

## What's Configured

### OpenSaaS Migration Plugin

The migration assistant plugin provides:
- **Migration Assistant Agent**: Contextual help throughout the migration
- **Slash Commands**: \`/analyze-schema\`, \`/generate-config\`, \`/validate-migration\`
- **Migration Skill**: Expert knowledge about migration patterns

### MCP Server

The \`.mcp.json\` file configures the OpenSaaS migration MCP server with tools for:
- Schema analysis
- Interactive migration wizard
- Documentation search
- Code generation

When you open this project in Claude Code, you may be prompted to approve the MCP server.

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
- [GitHub Repository](https://github.com/OpenSaasAU/stack)

---

*Generated by \`npx @opensaas/stack-cli migrate --with-ai\`*
`

  fs.writeFileSync(path.join(claudeDir, 'README.md'), readmeContent)
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
      console.log(chalk.dim('   ├─ Installed opensaas-migration plugin'))
      console.log(chalk.dim('   ├─ Configured .claude/settings.json'))
      console.log(chalk.dim('   ├─ Wrote opensaas-project.json (project metadata)'))
      console.log(chalk.dim('   └─ Created .mcp.json (MCP server config)'))
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
