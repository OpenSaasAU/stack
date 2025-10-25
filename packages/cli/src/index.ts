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
  .description('Create a new OpenSaas project')
  .option('-t, --template <template>', 'Project template to use')
  .action(async (projectName) => {
    await initCommand(projectName)
  })

program
  .command('dev')
  .description('Watch opensaas.config.ts and regenerate on changes')
  .action(async () => {
    await devCommand()
  })

program.parse()
