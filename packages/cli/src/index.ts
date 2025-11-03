#!/usr/bin/env node

import { Command } from 'commander'
import { generateCommand } from './commands/generate.js'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'

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
  .allowUnknownOption() // Allow passing through other options
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

program.parse()
