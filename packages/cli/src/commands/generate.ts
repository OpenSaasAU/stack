import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import chalk from 'chalk'
import ora from 'ora'
import { createJiti } from 'jiti'
import {
  writePrismaSchema,
  writePrismaConfig,
  writeTypes,
  writeLists,
  writeContext,
  writePluginTypes,
  writePrismaExtensions,
} from '../generator/index.js'
import { OpenSaasConfig } from '@opensaas/stack-core'

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

    // Config may be async (if plugins are present)
    // jiti.import() returns a module object with 'default' export
    // We need to manually extract the default export since interopDefault doesn't work with async exports
    const module = (await jiti.import(configPath)) as { default: Promise<OpenSaasConfig> }
    const configOrPromise = module.default

    // Resolve the config if it's a Promise (from plugin execution)
    let config = await Promise.resolve(configOrPromise)

    // Log plugin count if plugins are present
    if (config.plugins && config.plugins.length > 0) {
      spinner.text = `Loading configuration with ${config.plugins.length} plugin(s)...`
    }

    spinner.succeed(chalk.green('Configuration loaded'))

    // Execute beforeGenerate hooks if plugins are present
    if (config.plugins && config.plugins.length > 0) {
      const pluginSpinner = ora('Running plugin beforeGenerate hooks...').start()

      try {
        // Import plugin engine (avoid circular dependency)
        const { executeBeforeGenerateHooks } =
          await import('@opensaas/stack-core/config/plugin-engine')
        config = await executeBeforeGenerateHooks(config)
        pluginSpinner.succeed(chalk.green('Plugin beforeGenerate hooks complete'))
      } catch (err) {
        pluginSpinner.fail(chalk.red('Plugin beforeGenerate hooks failed'))
        throw err
      }
    }

    // Generate Prisma schema, types, and context
    const generatorSpinner = ora('Generating schema and types...').start()
    try {
      const prismaSchemaPath = path.join(cwd, 'prisma', 'schema.prisma')
      const prismaConfigPath = path.join(cwd, 'prisma.config.ts')
      const typesPath = path.join(cwd, '.opensaas', 'types.ts')
      const listsPath = path.join(cwd, '.opensaas', 'lists.ts')
      const contextPath = path.join(cwd, '.opensaas', 'context.ts')
      const pluginTypesPath = path.join(cwd, '.opensaas', 'plugin-types.ts')
      const prismaExtensionsPath = path.join(cwd, '.opensaas', 'prisma-extensions.ts')

      writePrismaSchema(config, prismaSchemaPath)
      writePrismaConfig(config, prismaConfigPath)
      writeTypes(config, typesPath)
      writeLists(config, listsPath)
      writeContext(config, contextPath)
      writePluginTypes(config, pluginTypesPath)
      writePrismaExtensions(config, prismaExtensionsPath)

      generatorSpinner.succeed(chalk.green('Schema generation complete'))
      console.log(chalk.green('✅ Prisma schema generated'))
      console.log(chalk.green('✅ Prisma config generated'))
      console.log(chalk.green('✅ TypeScript types generated'))
      console.log(chalk.green('✅ Lists namespace generated'))
      console.log(chalk.green('✅ Context factory generated'))
      console.log(chalk.green('✅ Plugin types generated'))
      console.log(chalk.green('✅ Prisma extensions generated'))

      // Execute afterGenerate hooks if plugins are present
      if (config.plugins && config.plugins.length > 0) {
        const afterGenSpinner = ora('Running plugin afterGenerate hooks...').start()

        try {
          // Read generated files
          const generatedFiles = {
            prismaSchema: fs.readFileSync(prismaSchemaPath, 'utf-8'),
            types: fs.readFileSync(typesPath, 'utf-8'),
            context: fs.readFileSync(contextPath, 'utf-8'),
          }

          // Execute afterGenerate hooks
          const { executeAfterGenerateHooks } =
            await import('@opensaas/stack-core/config/plugin-engine')
          const modifiedFiles = await executeAfterGenerateHooks(config, generatedFiles)

          // Write back modified files
          if (modifiedFiles.prismaSchema !== generatedFiles.prismaSchema) {
            fs.writeFileSync(prismaSchemaPath, modifiedFiles.prismaSchema)
          }
          if (modifiedFiles.types !== generatedFiles.types) {
            fs.writeFileSync(typesPath, modifiedFiles.types)
          }
          if (modifiedFiles.context !== generatedFiles.context) {
            fs.writeFileSync(contextPath, modifiedFiles.context)
          }

          // Write any additional files plugins generated
          for (const [filename, content] of Object.entries(modifiedFiles)) {
            if (!['prismaSchema', 'types', 'context'].includes(filename)) {
              const filePath = path.join(cwd, '.opensaas', filename)
              fs.writeFileSync(filePath, content)
              console.log(chalk.green(`✅ Plugin generated: ${filename}`))
            }
          }

          afterGenSpinner.succeed(chalk.green('Plugin afterGenerate hooks complete'))
        } catch (err) {
          afterGenSpinner.fail(chalk.red('Plugin afterGenerate hooks failed'))
          throw err
        }
      }
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
