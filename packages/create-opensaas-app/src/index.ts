#!/usr/bin/env node
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import prompts from 'prompts'
import chalk from 'chalk'
import ora from 'ora'
import { validateProjectName } from './lib/project-name.js'
import { generateEnvFiles } from './lib/env.js'
import { applyProjectName, rewriteReadmeHeading } from './lib/package-json.js'
import { removedDbFlagMessage } from './lib/args.js'
import { planSetupSteps, formatStepFailure, nextStepCommands, type SetupStep } from './lib/setup.js'
import { removeAiTooling } from './lib/ai-tooling.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TemplateOptions {
  projectName: string
  withAuth: boolean
  enableMCP: boolean
  /** Skip the automatic install → generate after scaffolding. */
  skipInstall: boolean
}

async function main() {
  console.log(chalk.bold.cyan('\n✨ Create OpenSaas Stack Application\n'))

  const args = process.argv.slice(2)
  const removedFlag = removedDbFlagMessage(args)
  if (removedFlag) {
    console.error(chalk.red(`\n❌ ${removedFlag}`))
    process.exit(1)
  }

  let projectName = args.find((arg) => !arg.startsWith('--'))
  const hasAuthFlag = args.includes('--with-auth')
  const hasNoAuthFlag = args.includes('--no-auth')
  const hasAiFlag = args.includes('--with-ai')
  // Explicit opt-outs so the CLI can run fully non-interactively (e.g. in CI or
  // an automated first-run guard): `--no-auth` skips the auth prompt and
  // `--no-ai` skips the AI-tooling prompt and its networked MCP install.
  const hasNoAiFlag = args.includes('--no-ai')
  const skipInstall = args.includes('--no-install') || args.includes('--skip-install')

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

  const validation = validateProjectName(projectName)
  if (!validation.ok) {
    console.error(chalk.red(`\n❌ ${validation.message}`))
    process.exit(1)
  }
  if (!projectName) {
    // Unreachable: validateProjectName rejects empty names. Narrows the type.
    process.exit(1)
  }

  let withAuth = hasAuthFlag
  if (!hasAuthFlag && !hasNoAuthFlag) {
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

  let enableMCP = hasAiFlag
  if (!hasAiFlag && !hasNoAiFlag) {
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

  await createProject({ projectName, withAuth, enableMCP, skipInstall })
}

async function createProject(options: TemplateOptions) {
  const { projectName, withAuth, enableMCP, skipInstall } = options

  const spinner = ora('Creating project...').start()

  try {
    const template = withAuth ? 'with-auth' : 'basic'
    const templateDir = path.join(__dirname, '../templates', template)
    const targetDir = path.join(process.cwd(), projectName)

    if (await fs.pathExists(targetDir)) {
      spinner.fail(chalk.red(`Directory ${projectName} already exists`))
      process.exit(1)
    }

    if (!(await fs.pathExists(templateDir))) {
      spinner.fail(chalk.red(`Template ${template} not found`))
      console.error(chalk.dim(`\nExpected template at: ${templateDir}`))
      console.error(
        chalk.dim('Run "pnpm build" in packages/create-opensaas-app to generate templates'),
      )
      process.exit(1)
    }

    await fs.copy(templateDir, targetDir)

    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = await fs.readJSON(pkgPath)
    await fs.writeJSON(pkgPath, applyProjectName(pkg, projectName), { spaces: 2 })

    const readmePath = path.join(targetDir, 'README.md')
    if (await fs.pathExists(readmePath)) {
      const readme = await fs.readFile(readmePath, 'utf-8')
      await fs.writeFile(readmePath, rewriteReadmeHeading(readme, projectName))
    }

    // Write a runnable .env so `pnpm generate` works with no manual setup.
    await writeEnvFile(targetDir, projectName, withAuth)

    // Templates ship a Claude Code AI bundle (project CLAUDE.md + .claude/).
    // Remove it when the user opted out of AI tooling.
    await removeAiTooling(targetDir, enableMCP)

    spinner.succeed(chalk.green('Project created!'))

    if (enableMCP) {
      await installMCPServer()
    }

    // Auto-run install → generate so the project is ready for `pnpm dev`
    // immediately. Opt out entirely with --no-install.
    const autoRan = skipInstall ? false : await runSetup(targetDir, projectName)

    console.log(chalk.green('\n✅ Your project is ready!\n'))
    console.log(chalk.bold('Next steps:\n'))
    for (const command of nextStepCommands({ projectName, autoRan })) {
      console.log(chalk.cyan(`  ${command}`))
    }

    console.log(chalk.bold('\n🤖 Then build with Claude Code:'))
    console.log(
      chalk.dim('   Open this project in Claude Code and describe what you want to build,'),
    )
    console.log(chalk.dim('   e.g. "add a comments feature to posts" — it builds it for you.\n'))

    if (withAuth) {
      console.log(chalk.dim('💡 Set BETTER_AUTH_SECRET in .env before signing in.'))
      console.log(chalk.dim('   Generate a secret with: openssl rand -base64 32\n'))
    } else {
      console.log(chalk.dim('Once running, visit http://localhost:3000/admin for your admin UI.\n'))
    }

    if (!enableMCP) {
      console.log(chalk.dim('💡 Enable AI development tools later with:'))
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
 * The basic template gets canonical env files. The auth template ships a
 * complete `.env.example` (database + Better-auth variables), so its `.env` is
 * seeded from that example to preserve those extra variables.
 */
async function writeEnvFile(
  targetDir: string,
  projectName: string,
  withAuth: boolean,
): Promise<void> {
  const envPath = path.join(targetDir, '.env')
  const envExamplePath = path.join(targetDir, '.env.example')

  if (withAuth && (await fs.pathExists(envExamplePath))) {
    const example = await fs.readFile(envExamplePath, 'utf-8')
    await fs.writeFile(envPath, example)
    return
  }

  const { env, envExample } = generateEnvFiles({ projectName })
  await fs.writeFile(envPath, env)
  await fs.writeFile(envExamplePath, envExample)
}

/**
 * Run install → generate in the new project so `pnpm dev` works immediately.
 * Stops at the first failure and prints a recoverable message naming the
 * failed step. Returns whether every step succeeded.
 */
async function runSetup(targetDir: string, projectName: string): Promise<boolean> {
  for (const step of planSetupSteps()) {
    console.log(chalk.cyan(`\n▶ ${step.title}...`))
    const ok = await runStep(step, targetDir)
    if (!ok) {
      console.log(chalk.yellow(`\n⚠️  ${formatStepFailure(step, projectName)}\n`))
      return false
    }
  }
  return true
}

function runStep(step: SetupStep, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', step.args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
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
