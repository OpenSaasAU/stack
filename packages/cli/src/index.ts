#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { generateCommand, GenerationFailedError } from './commands/generate.js'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'
import { createDbCommand } from './commands/db.js'
import { createMCPCommand } from './commands/mcp.js'
import { createMigrateCommand } from './commands/migrate.js'

const manifest: { version: string } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
)

const program = new Command()

program.name('opensaas').description('OpenSaas Stack CLI').version(manifest.version)

program
  .command('generate')
  .description('Generate the database contract and TypeScript types from opensaas.config.ts')
  .action(async () => {
    try {
      await generateCommand()
    } catch (error) {
      if (!(error instanceof GenerationFailedError)) throw error
      process.exit(1)
    }
  })

program
  .command('init [project-name]')
  .description('Create a new OpenSaas project (delegates to create-opensaas-app)')
  .option('--with-auth', 'Include authentication (Better-auth)')
  .allowUnknownOption() // Allow passing through other options
  .action(async (projectName, options) => {
    const args = []
    if (projectName) args.push(projectName)
    if (options.withAuth) args.push('--with-auth')
    await initCommand(args)
  })

program
  .command('dev')
  .description('Start the dev database, generate, reconcile the schema and run the app')
  .argument('[command...]', 'App command to run instead of `next dev`, after `--`')
  .option(
    '--yes',
    'Apply the startup schema plan to a database named by DATABASE_URL without stopping',
  )
  .action(async (command: string[], options: { yes?: boolean }) => {
    await devCommand({ appCommand: command, yes: options.yes })
  })

program.addCommand(createDbCommand())

// Add MCP command group
program.addCommand(createMCPCommand())

// Add migrate command
program.addCommand(createMigrateCommand())

program.parse()
