import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import chalk from 'chalk'
import ora from 'ora'
import { createJiti } from 'jiti'
import {
  writePrismaSchema,
  writeTypes,
  writeContext,
  patchPrismaTypes,
} from '../generator/index.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'

export async function generateCommand() {
  console.log(chalk.bold('\n🚀 OpenSaas Generator\n'))

  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  // Check if config exists
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('❌ Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    process.exit(1)
  }

  const spinner = ora('Loading configuration...').start()

  try {
    // Load config using jiti (supports TypeScript)
    const jiti = createJiti(cwd, {
      interopDefault: true,
    })

    const config = (await jiti.import(configPath)) as OpenSaasConfig

    spinner.succeed(chalk.green('Configuration loaded'))

    // Generate Prisma schema, types, and context
    const generatorSpinner = ora('Generating schema and types...').start()
    try {
      writePrismaSchema(config, path.join(cwd, 'prisma', 'schema.prisma'))
      writeTypes(config, path.join(cwd, '.opensaas', 'types.ts'))
      writeContext(config, path.join(cwd, '.opensaas', 'context.ts'))

      generatorSpinner.succeed(chalk.green('Schema generation complete'))
      console.log(chalk.green('✅ Prisma schema generated'))
      console.log(chalk.green('✅ TypeScript types generated'))
      console.log(chalk.green('✅ Context factory generated'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      generatorSpinner.fail(chalk.red('Failed to generate'))
      console.error(chalk.red('\n❌ Error:'), err.message)
      if (err.stack) {
        console.error(chalk.gray('\n' + err.stack))
      }
      process.exit(1)
    }

    // Run Prisma generate to create the Prisma client
    const prismaSpinner = ora('Generating Prisma client...').start()
    try {
      execSync('npx prisma generate', {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      prismaSpinner.succeed(chalk.green('Prisma client generated'))
      console.log(chalk.green('✅ Prisma client generated'))
    } catch (err) {
      prismaSpinner.fail(chalk.red('Failed to generate Prisma client'))
      const message = err instanceof Error ? err.message : String(err)
      console.error(chalk.red('\n❌ Error:'), message)
      process.exit(1)
    }

    // Patch Prisma types with field transformations
    const patchSpinner = ora('Patching Prisma types...').start()
    try {
      patchPrismaTypes(config, cwd)
      patchSpinner.succeed(chalk.green('Type patching complete'))
    } catch (err) {
      patchSpinner.fail(chalk.red('Failed to patch types'))
      const message = err instanceof Error ? err.message : String(err)
      console.error(chalk.red('\n❌ Error:'), message)
      process.exit(1)
    }

    console.log(chalk.bold('\n✨ Generation complete!\n'))
    console.log(chalk.gray('Next steps:'))
    console.log(chalk.gray('  1. Run: npx prisma db push'))
    console.log(chalk.gray('  2. Start using your generated types!\n'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    spinner.fail(chalk.red('Generation failed'))
    console.error(chalk.red('\n❌ Error:'), error.message)
    if (error.stack) {
      console.error(chalk.gray('\n' + error.stack))
    }
    process.exit(1)
  }
}
