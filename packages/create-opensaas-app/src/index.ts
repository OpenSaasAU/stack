#!/usr/bin/env node
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import prompts from 'prompts'
import chalk from 'chalk'
import ora from 'ora'
import { validateProjectName } from './lib/project-name.js'
import { generateEnvFiles, type DbProvider } from './lib/env.js'
import { applyProjectName, rewriteReadmeHeading } from './lib/package-json.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TemplateOptions {
  projectName: string
  withAuth: boolean
  enableMCP: boolean
}

async function main() {
  console.log(chalk.bold.cyan('\n✨ Create OpenSaas Stack Application\n'))

  // Parse command line arguments
  const args = process.argv.slice(2)
  let projectName = args.find((arg) => !arg.startsWith('--'))
  const hasAuthFlag = args.includes('--with-auth')
  const hasAiFlag = args.includes('--with-ai')

  // Prompt for project name if not provided
  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-app',
      validate: (value) => {
        const result = validateProjectName(value)
        return result.ok ? true : result.message
      },
    })

    if (!response.projectName) {
      console.log(chalk.yellow('\n👋 Cancelled'))
      process.exit(0)
    }

    projectName = response.projectName
  }

  // Validate project name
  const validation = validateProjectName(projectName)
  if (!validation.ok) {
    console.error(chalk.red(`\n❌ ${validation.message}`))
    process.exit(1)
  }
  if (!projectName) {
    // Unreachable: validateProjectName rejects empty names. Narrows the type.
    process.exit(1)
  }

  // Prompt for auth if not specified via flag
  let withAuth = hasAuthFlag
  if (!hasAuthFlag) {
    const response = await prompts({
      type: 'confirm',
      name: 'withAuth',
      message: 'Include authentication? (Better-auth)',
      initial: false,
    })

    if (response.withAuth === undefined) {
      console.log(chalk.yellow('\n👋 Cancelled'))
      process.exit(0)
    }

    withAuth = response.withAuth
  }

  // Prompt for MCP/AI development tools if not specified via flag
  let enableMCP = hasAiFlag
  if (!hasAiFlag) {
    const mcpResponse = await prompts({
      type: 'confirm',
      name: 'enableMCP',
      message: 'Enable AI development tools? (MCP server + Claude Code plugin)',
      initial: true,
    })

    if (mcpResponse.enableMCP === undefined) {
      console.log(chalk.yellow('\n👋 Cancelled'))
      process.exit(0)
    }

    enableMCP = mcpResponse.enableMCP
  }

  // Create project
  await createProject({ projectName, withAuth, enableMCP })
}

async function createProject(options: TemplateOptions) {
  const { projectName, withAuth, enableMCP } = options

  const spinner = ora('Creating project...').start()

  try {
    // Determine template
    const template = withAuth ? 'with-auth' : 'basic'
    const templateDir = path.join(__dirname, '../templates', template)
    const targetDir = path.join(process.cwd(), projectName)

    // Check if directory already exists
    if (await fs.pathExists(targetDir)) {
      spinner.fail(chalk.red(`Directory ${projectName} already exists`))
      process.exit(1)
    }

    // Check if template exists
    if (!(await fs.pathExists(templateDir))) {
      spinner.fail(chalk.red(`Template ${template} not found`))
      console.error(chalk.dim(`\nExpected template at: ${templateDir}`))
      console.error(
        chalk.dim('Run "pnpm build" in packages/create-opensaas-app to generate templates'),
      )
      process.exit(1)
    }

    // Copy template files
    await fs.copy(templateDir, targetDir)

    // Customize package.json
    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = await fs.readJSON(pkgPath)
    await fs.writeJSON(pkgPath, applyProjectName(pkg, projectName), { spaces: 2 })

    // Customize README
    const readmePath = path.join(targetDir, 'README.md')
    if (await fs.pathExists(readmePath)) {
      const readme = await fs.readFile(readmePath, 'utf-8')
      await fs.writeFile(readmePath, rewriteReadmeHeading(readme, projectName))
    }

    // Write a runnable .env so `pnpm generate` / `pnpm db:push` work with no
    // manual setup. Both starter templates use SQLite by default.
    await writeEnvFile(targetDir, projectName, 'sqlite', withAuth)

    spinner.succeed(chalk.green('Project created!'))

    // Install MCP server if requested
    if (enableMCP) {
      await installMCPServer()
    }

    // Show next steps
    console.log(chalk.green('\n✅ Project created successfully!\n'))
    console.log(chalk.bold('Next steps:\n'))
    console.log(chalk.cyan(`  cd ${projectName}`))
    console.log(chalk.cyan(`  pnpm install`))
    console.log(chalk.cyan(`  pnpm generate`))
    console.log(chalk.cyan(`  pnpm db:push`))
    console.log(chalk.cyan(`  pnpm dev`))

    if (withAuth) {
      console.log(chalk.dim("\n💡 Don't forget to set up your .env file with BETTER_AUTH_SECRET"))
      console.log(chalk.dim('   Generate a secret with: openssl rand -base64 32\n'))
    } else {
      console.log(chalk.dim('\nVisit http://localhost:3000/admin to see your admin UI\n'))
    }

    if (!enableMCP) {
      console.log(chalk.dim('\n💡 Enable AI development tools later with:'))
      console.log(chalk.dim('   npx @opensaas/stack-cli mcp install\n'))
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to create project'))
    console.error(error)
    process.exit(1)
  }
}

/**
 * Write a runnable `.env` into the scaffolded project.
 *
 * The basic template gets canonical, provider-aware env files. The auth
 * template ships a complete `.env.example` (database + Better-auth variables),
 * so we seed its `.env` from that example to preserve those extra variables
 * while still guaranteeing a working `DATABASE_URL`.
 */
async function writeEnvFile(
  targetDir: string,
  projectName: string,
  provider: DbProvider,
  withAuth: boolean,
): Promise<void> {
  const envPath = path.join(targetDir, '.env')
  const envExamplePath = path.join(targetDir, '.env.example')

  if (withAuth && (await fs.pathExists(envExamplePath))) {
    await fs.copy(envExamplePath, envPath, { overwrite: true })
    return
  }

  const { env, envExample } = generateEnvFiles({ provider, projectName })
  await fs.writeFile(envPath, env)
  await fs.writeFile(envExamplePath, envExample)
}

async function installMCPServer(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.cyan('\n📦 Installing MCP server for AI development tools...'))

    const child = spawn('npx', ['@opensaas/stack-cli', 'mcp', 'install'], {
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✅ MCP server installed!'))
        console.log(chalk.dim('🔄 Restart Claude Code to use AI development tools.'))
        resolve(true)
      } else {
        console.log(chalk.yellow('\n⚠️  MCP installation failed. You can install it later with:'))
        console.log(chalk.dim('   npx @opensaas/stack-cli mcp install'))
        resolve(false)
      }
    })

    child.on('error', () => {
      console.log(chalk.yellow('\n⚠️  Could not install MCP server automatically.'))
      console.log(chalk.dim('   You can install it later with:'))
      console.log(chalk.dim('   npx @opensaas/stack-cli mcp install'))
      resolve(false)
    })
  })
}

main().catch((error) => {
  console.error(chalk.red('\n❌ An error occurred:'))
  console.error(error)
  process.exit(1)
})
