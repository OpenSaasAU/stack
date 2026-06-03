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
  resolveOutputPaths,
} from '../generator/index.js'
import { OpenSaasConfig, validateConfigFields } from '@opensaas/stack-core'
import type { FieldConfigValidationError } from '@opensaas/stack-core'

/**
 * Format field self-containment errors into a friendly, multi-line message.
 * Each violation names the list, field, and the contract method it omits, so
 * a misimplemented (often third-party) field is actionable at a glance rather
 * than surfacing as a deep generator stack trace.
 */
export function formatFieldValidationErrors(errors: FieldConfigValidationError[]): string {
  const lines = errors.map((error) => {
    const location = error.listKey ? `${error.listKey}.${error.fieldKey}` : error.fieldKey
    return `  • ${location} (type "${error.fieldType}") is missing ${error.missingMethod}()`
  })

  return [
    `${errors.length} field(s) do not satisfy the self-containment contract:`,
    ...lines,
    '',
    'Each field builder must implement getPrismaType, getTypeScriptType, and',
    'getZodSchema (or getPrismaRelation for relationships) so the generator can',
    'produce schema and types without inspecting field internals.',
  ].join('\n')
}

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

    // Validate field self-containment up front, before any generation runs.
    // A misimplemented field surfaces a clear, per-field message here rather
    // than throwing deep inside schema/type generation.
    const validationSpinner = ora('Validating field configuration...').start()
    const fieldErrors = validateConfigFields(config)
    if (fieldErrors.length > 0) {
      validationSpinner.fail(chalk.red('Field configuration invalid'))
      console.error(chalk.red('\n❌ Error:'), formatFieldValidationErrors(fieldErrors))
      process.exit(1)
    }
    validationSpinner.succeed(chalk.green('Field configuration valid'))

    // Generate Prisma schema, types, and context
    const generatorSpinner = ora('Generating schema and types...').start()
    try {
      // Resolve write paths and the relative cross-references between generated
      // files from the (optional) `output` config block. The pre-existing
      // top-level `opensaasPath` option is forwarded as the bundle-directory
      // fallback so it keeps working through the CLI when `output.opensaasDir`
      // is not set (precedence: `output.opensaasDir` > `opensaasPath` >
      // default). With neither set this yields the historical defaults
      // (`prisma/schema.prisma`, `.opensaas/`) byte-for-byte.
      const { paths, crossReferences } = resolveOutputPaths(cwd, config.output, config.opensaasPath)

      const prismaSchemaPath = paths.prismaSchema
      const prismaConfigPath = paths.prismaConfig
      const typesPath = paths.types
      const listsPath = paths.lists
      const contextPath = paths.context
      const pluginTypesPath = paths.pluginTypes
      const prismaExtensionsPath = paths.prismaExtensions

      writePrismaSchema(config, prismaSchemaPath, crossReferences.prismaClientOutput)
      writePrismaConfig(config, prismaConfigPath, crossReferences.prismaConfigSchema)
      writeTypes(config, typesPath)
      writeLists(config, listsPath)
      writeContext(config, contextPath, crossReferences.configImport)
      writePluginTypes(config, pluginTypesPath)
      writePrismaExtensions(config, prismaExtensionsPath, crossReferences.configImport)

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
              const filePath = path.join(paths.opensaasDir, filename)
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

      // Format Prisma schema
      const formatSpinner = ora('Formatting Prisma schema...').start()
      try {
        execSync('npx prisma format', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        })
        formatSpinner.succeed(chalk.green('Prisma schema formatted'))
        console.log(chalk.green('✅ Prisma schema formatted'))
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err) {
        // Formatting is optional - don't fail generation if it doesn't work
        formatSpinner.warn(chalk.yellow('Prisma schema formatting skipped'))
        console.log(
          chalk.yellow('⚠️  Prisma format failed (this is non-critical, continuing generation)'),
        )
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
