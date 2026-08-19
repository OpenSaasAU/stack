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
import { toPostgresConfig, toPostgresPackageJson } from './lib/postgres.js'
import { planSetupSteps, formatStepFailure, nextStepCommands, type SetupStep } from './lib/setup.js'
import { removeAiTooling } from './lib/ai-tooling.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TemplateOptions {
  projectName: string
  withAuth: boolean
  enableMCP: boolean
  /** Which database the scaffolded project targets (SQLite by default). */
  dbProvider: DbProvider
  /** Skip the automatic install → generate → db:push after scaffolding. */
  skipInstall: boolean
}

/**
 * Parse the `--db <provider>` flag (`--db postgres`, `--db sqlite`, or
 * `--db=...`). Returns the chosen provider when the flag fixes it (so the
 * interactive prompt is bypassed), or `undefined` when the flag is absent (so
 * the CLI prompts). An unrecognised value exits with a clear message rather
 * than silently defaulting.
 */
function parseDbFlag(args: string[]): DbProvider | undefined {
  const index = args.indexOf('--db')
  // The flag is absent only when neither `--db` nor `--db=...` appears. A bare
  // `--db` with no following value (`args[index + 1]` is `undefined`) is a usage
  // error, not an absent flag, so it errors like an unknown value rather than
  // silently defaulting.
  const hasSpaceFlag = index !== -1
  const value = hasSpaceFlag
    ? args[index + 1]
    : args.find((arg) => arg.startsWith('--db='))?.slice('--db='.length)
  if (value === undefined && !hasSpaceFlag) return undefined
  if (value === 'sqlite') return 'sqlite'
  // Accept the friendly `postgres` alias as well as the canonical provider name.
  if (value === 'postgres' || value === 'postgresql') return 'postgresql'
  console.error(chalk.red(`\n❌ Unknown --db value "${value ?? ''}". Use "sqlite" or "postgres".`))
  process.exit(1)
}

async function main() {
  console.log(chalk.bold.cyan('\n✨ Create OpenSaas Stack Application\n'))

  const args = process.argv.slice(2)
  // The project name is the first positional arg. Skip the value consumed by a
  // space-separated `--db <provider>` so e.g. `--db postgres my-app` still picks
  // `my-app` (not `postgres`).
  const dbFlagIndex = args.indexOf('--db')
  const consumedByDbFlag = dbFlagIndex !== -1 ? dbFlagIndex + 1 : -1
  let projectName = args.find((arg, i) => !arg.startsWith('--') && i !== consumedByDbFlag)
  const hasAuthFlag = args.includes('--with-auth')
  const hasNoAuthFlag = args.includes('--no-auth')
  const hasAiFlag = args.includes('--with-ai')
  // Explicit opt-outs so the CLI can run fully non-interactively (e.g. in CI or
  // an automated first-run guard): `--no-auth` skips the auth prompt and
  // `--no-ai` skips the AI-tooling prompt and its networked MCP install.
  const hasNoAiFlag = args.includes('--no-ai')
  const skipInstall = args.includes('--no-install') || args.includes('--skip-install')
  // `--db postgres` / `--db sqlite` fixes the database choice and bypasses the
  // prompt; absent, we prompt (defaulting to SQLite, the zero-setup local DB).
  const dbFlag = parseDbFlag(args)

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

  // SQLite is the default (zero-setup local dev); PostgreSQL emits the
  // production-ready pg driver adapter, a Postgres `.env`, and migrate scripts
  // from day one.
  let dbProvider: DbProvider = dbFlag ?? 'sqlite'
  if (!dbFlag) {
    const dbResponse = await prompts({
      type: 'select',
      name: 'dbProvider',
      message: 'Which database?',
      choices: [
        { title: 'SQLite (zero setup, great for local development)', value: 'sqlite' },
        { title: 'PostgreSQL (production-ready)', value: 'postgresql' },
      ],
      initial: 0,
    })

    if (dbResponse.dbProvider === undefined) {
      console.log(chalk.yellow('\n👋 Cancelled'))
      process.exit(0)
    }

    dbProvider = dbResponse.dbProvider
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

  await createProject({ projectName, withAuth, enableMCP, dbProvider, skipInstall })
}

async function createProject(options: TemplateOptions) {
  const { projectName, withAuth, enableMCP, dbProvider, skipInstall } = options

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

    // Templates are SQLite-based, so a `--db postgres` project swaps the
    // SQLite adapter/driver for the Postgres ones (the transform preserves
    // scripts — including migrate/migrate:deploy — and the @opensaas deps).
    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = await fs.readJSON(pkgPath)
    const namedPkg = applyProjectName(pkg, projectName)
    const finalPkg = dbProvider === 'postgresql' ? toPostgresPackageJson(namedPkg) : namedPkg
    await fs.writeJSON(pkgPath, finalPkg, { spaces: 2 })

    // SQLite keeps the template's config untouched.
    if (dbProvider === 'postgresql') {
      await rewriteConfigForPostgres(targetDir)
    }

    const readmePath = path.join(targetDir, 'README.md')
    if (await fs.pathExists(readmePath)) {
      const readme = await fs.readFile(readmePath, 'utf-8')
      await fs.writeFile(readmePath, rewriteReadmeHeading(readme, projectName))
    }

    // Write a runnable .env so `pnpm generate` / `pnpm db:push` work with no
    // manual setup. SQLite is the template default; PostgreSQL emits the
    // pooled DATABASE_URL + direct DIRECT_DATABASE_URL placeholders.
    await writeEnvFile(targetDir, projectName, dbProvider, withAuth)

    // Templates ship a Claude Code AI bundle (project CLAUDE.md + .claude/).
    // Remove it when the user opted out of AI tooling.
    await removeAiTooling(targetDir, enableMCP)

    spinner.succeed(chalk.green('Project created!'))

    if (enableMCP) {
      await installMCPServer()
    }

    // Auto-run install → generate (→ db:push for SQLite) so the project is
    // ready for `pnpm dev` immediately. Postgres skips db:push: it needs a real
    // database the user configures first. Opt out entirely with --no-install.
    const autoRan = skipInstall ? false : await runSetup(targetDir, projectName, dbProvider)

    console.log(chalk.green('\n✅ Your project is ready!\n'))
    console.log(chalk.bold('Next steps:\n'))
    for (const command of nextStepCommands({ projectName, autoRan, provider: dbProvider })) {
      console.log(chalk.cyan(`  ${command}`))
    }

    console.log(chalk.bold('\n🤖 Then build with Claude Code:'))
    console.log(
      chalk.dim('   Open this project in Claude Code and describe what you want to build,'),
    )
    console.log(chalk.dim('   e.g. "add a comments feature to posts" — it builds it for you.\n'))

    if (dbProvider === 'postgresql') {
      console.log(
        chalk.dim('💡 Set DATABASE_URL (pooled) and DIRECT_DATABASE_URL (direct) in .env'),
      )
      console.log(chalk.dim('   to your PostgreSQL connection strings, then run:'))
      console.log(chalk.dim('   pnpm migrate   # create and apply the first migration\n'))
    }

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
 * Rewrite the scaffolded `opensaas.config.ts` from the SQLite driver adapter to
 * the PostgreSQL `PrismaPg` one. The transform itself is the pure,
 * unit-tested `toPostgresConfig`; this wrapper just reads and writes the file.
 */
async function rewriteConfigForPostgres(targetDir: string): Promise<void> {
  const configPath = path.join(targetDir, 'opensaas.config.ts')
  const source = await fs.readFile(configPath, 'utf-8')
  await fs.writeFile(configPath, toPostgresConfig(source))
}

/**
 * Write a runnable `.env` into the scaffolded project.
 *
 * The basic template gets canonical, provider-aware env files. The auth
 * template ships a complete `.env.example` (database + Better-auth variables),
 * so we seed its `.env` from that example to preserve those extra variables —
 * swapping just the database block for the chosen provider so the rest (the
 * Better-auth secret/URL placeholders) survives.
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
    // Overwrites `.env.example` too, not just `.env`, so both reflect the chosen provider.
    const example = await fs.readFile(envExamplePath, 'utf-8')
    const withDb =
      provider === 'postgresql' ? replaceAuthEnvDatabase(example, projectName) : example
    await fs.writeFile(envExamplePath, withDb)
    await fs.writeFile(envPath, withDb)
    return
  }

  const { env, envExample } = generateEnvFiles({ provider, projectName })
  await fs.writeFile(envPath, env)
  await fs.writeFile(envExamplePath, envExample)
}

/**
 * Swap the SQLite database line in the auth template's `.env` content for the
 * Postgres pooled/direct placeholders, leaving the Better-auth variables (and
 * everything else) untouched.
 */
function replaceAuthEnvDatabase(content: string, projectName: string): string {
  const { env: pgDbBlock } = generateEnvFiles({ provider: 'postgresql', projectName })
  // The auth template's database section is the single `DATABASE_URL=file:./dev.db`
  // line (optionally preceded by a `# Database` comment). Replace it in place.
  return content.replace(/^DATABASE_URL=.*$/m, pgDbBlock.trimEnd())
}

/**
 * Run install → generate → db:push in the new project so `pnpm dev` works
 * immediately. Stops at the first failure and prints a recoverable message
 * naming the failed step. Returns whether every step succeeded.
 */
async function runSetup(
  targetDir: string,
  projectName: string,
  provider: DbProvider,
): Promise<boolean> {
  for (const step of planSetupSteps(provider)) {
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
