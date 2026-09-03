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
  resolveOutputPaths,
  buildNodeBundle,
  formatNodeBuildDiagnostics,
  resolveTsconfigAlias,
} from '../generator/index.js'
import {
  OpenSaasConfig,
  validateConfigFields,
  validateNeedsDeclarations,
  validateNeedsClosureDepth,
  validateDatabaseConfig,
  validateRelations,
} from '@opensaas/stack-core'
import type {
  ConfigRefusal,
  FieldConfigValidationError,
  NeedsClosureError,
} from '@opensaas/stack-core'

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

/**
 * Format `needs` declaration errors (ADR-0025) into a friendly, multi-line
 * message — an invalid relation name, a cyclic declaration chain, or a
 * closure too deep to ever be scoped, each naming the offending field.
 */
export function formatNeedsClosureErrors(errors: NeedsClosureError[]): string {
  const lines = errors.map((error) => `  • ${error.message}`)

  return [`${errors.length} field(s) declare an unsatisfiable \`needs\`:`, ...lines].join('\n')
}

/**
 * Format config-surface refusals (ADR-0040, ADR-0048, ADR-0049, ADR-0064)
 * into a friendly, multi-line message, each naming the list, the entry and
 * the fix.
 */
export function formatConfigRefusals(refusals: ConfigRefusal[]): string {
  const lines = refusals.map((refusal) => `  • ${refusal.message}`)

  return [`${refusals.length} config declaration(s) the contract cannot carry:`, ...lines].join(
    '\n',
  )
}

export async function generateCommand() {
  console.log(chalk.bold('\n🚀 OpenSaas Generator\n'))

  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('❌ Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    process.exit(1)
  }

  const spinner = ora('Loading configuration...').start()

  try {
    // Resolve tsconfig.json path aliases (e.g. "@/*") into jiti's alias
    // option, so a value import in opensaas.config.ts (or anything it
    // imports) can use the same aliases as the rest of the project (#905).
    // A project with no tsconfig.json, or no `paths`, resolves to
    // `alias: undefined`, which is identical to omitting the option.
    const { alias, warnings: aliasWarnings } = resolveTsconfigAlias(cwd)

    const jiti = createJiti(cwd, {
      interopDefault: true,
      alias,
    })

    // jiti's `interopDefault` doesn't unwrap an async `default` export, so it
    // must be extracted manually here (config may be a Promise when plugins
    // are present).
    const module = (await jiti.import(configPath)) as { default: Promise<OpenSaasConfig> }
    const configOrPromise = module.default
    let config = await Promise.resolve(configOrPromise)

    if (config.plugins && config.plugins.length > 0) {
      spinner.text = `Loading configuration with ${config.plugins.length} plugin(s)...`
    }

    spinner.succeed(chalk.green('Configuration loaded'))
    for (const warning of aliasWarnings) {
      console.log(chalk.yellow(`⚠️  ${warning}`))
    }

    if (config.plugins && config.plugins.length > 0) {
      const pluginSpinner = ora('Running plugin beforeGenerate hooks...').start()

      try {
        // Dynamic import avoids a circular dependency with the plugin engine.
        const { executeBeforeGenerateHooks } =
          await import('@opensaas/stack-core/config/plugin-engine')
        config = await executeBeforeGenerateHooks(config)
        pluginSpinner.succeed(chalk.green('Plugin beforeGenerate hooks complete'))
      } catch (err) {
        pluginSpinner.fail(chalk.red('Plugin beforeGenerate hooks failed'))
        throw err
      }
    }

    const validationSpinner = ora('Validating field configuration...').start()
    const fieldErrors = validateConfigFields(config)
    if (fieldErrors.length > 0) {
      validationSpinner.fail(chalk.red('Field configuration invalid'))
      console.error(chalk.red('\n❌ Error:'), formatFieldValidationErrors(fieldErrors))
      process.exit(1)
    }
    validationSpinner.succeed(chalk.green('Field configuration valid'))

    // Validate `needs` declarations (ADR-0025) up front too: an invalid
    // relation name, a cyclic declaration chain, or a closure deeper than
    // the read-include depth cap can ever scope (from any starting point)
    // must fail generation rather than silently truncate at runtime.
    const needsSpinner = ora('Validating declared dependencies...').start()
    const needsErrors = [...validateNeedsDeclarations(config), ...validateNeedsClosureDepth(config)]
    if (needsErrors.length > 0) {
      needsSpinner.fail(chalk.red('Declared dependencies invalid'))
      console.error(chalk.red('\n❌ Error:'), formatNeedsClosureErrors(needsErrors))
      process.exit(1)
    }
    needsSpinner.succeed(chalk.green('Declared dependencies valid'))

    const surfaceSpinner = ora('Validating config surface...').start()
    const refusals = [...validateDatabaseConfig(config), ...validateRelations(config)]
    if (refusals.length > 0) {
      surfaceSpinner.fail(chalk.red('Config surface invalid'))
      console.error(chalk.red('\n❌ Error:'), formatConfigRefusals(refusals))
      process.exit(1)
    }
    surfaceSpinner.succeed(chalk.green('Config surface valid'))

    // Captured here so the (optional) Node build step, which runs after
    // `prisma generate` outside this try block, knows where the bundle lives.
    let opensaasDir = ''
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
      opensaasDir = paths.opensaasDir

      const prismaSchemaPath = paths.prismaSchema
      const prismaConfigPath = paths.prismaConfig
      const typesPath = paths.types
      const listsPath = paths.lists
      const contextPath = paths.context
      const pluginTypesPath = paths.pluginTypes

      writePrismaSchema(config, prismaSchemaPath, crossReferences.prismaClientOutput)
      writePrismaConfig(config, prismaConfigPath, crossReferences.prismaConfigSchema)
      writeTypes(config, typesPath)
      writeLists(config, listsPath)
      writeContext(config, contextPath, crossReferences.configImport)
      writePluginTypes(config, pluginTypesPath)

      // A project generated before #958 removed the (dead) result-extension
      // module may still have it on disk — clean it up so it doesn't linger
      // as an orphaned, unimported file.
      const stalePrismaExtensionsPath = path.join(paths.opensaasDir, 'prisma-extensions.ts')
      if (fs.existsSync(stalePrismaExtensionsPath)) {
        fs.rmSync(stalePrismaExtensionsPath)
      }

      generatorSpinner.succeed(chalk.green('Schema generation complete'))
      console.log(chalk.green('✅ Prisma schema generated'))
      console.log(chalk.green('✅ Prisma config generated'))
      console.log(chalk.green('✅ TypeScript types generated'))
      console.log(chalk.green('✅ Lists namespace generated'))
      console.log(chalk.green('✅ Context factory generated'))
      console.log(chalk.green('✅ Plugin types generated'))

      if (config.plugins && config.plugins.length > 0) {
        const afterGenSpinner = ora('Running plugin afterGenerate hooks...').start()

        try {
          const generatedFiles = {
            prismaSchema: fs.readFileSync(prismaSchemaPath, 'utf-8'),
            types: fs.readFileSync(typesPath, 'utf-8'),
            context: fs.readFileSync(contextPath, 'utf-8'),
          }

          const { executeAfterGenerateHooks } =
            await import('@opensaas/stack-core/config/plugin-engine')
          const modifiedFiles = await executeAfterGenerateHooks(config, generatedFiles)

          if (modifiedFiles.prismaSchema !== generatedFiles.prismaSchema) {
            fs.writeFileSync(prismaSchemaPath, modifiedFiles.prismaSchema)
          }
          if (modifiedFiles.types !== generatedFiles.types) {
            fs.writeFileSync(typesPath, modifiedFiles.types)
          }
          if (modifiedFiles.context !== generatedFiles.context) {
            fs.writeFileSync(contextPath, modifiedFiles.context)
          }

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

    // Optional Node build (ADR-0011): when `output.buildTarget === 'node'`,
    // additionally compile the `.ts` bundle to a plain-Node-loadable ESM form
    // under `<opensaasDir>/dist/` so a live module (e.g. better-auth's adapter)
    // can be imported in a bundler-less runtime. Purely additive — the default
    // `.ts` form is untouched. Runs after `prisma generate` so the compiled
    // `prisma-client/**` subtree exists to compile in.
    if (config.output?.buildTarget === 'node') {
      const nodeBuildSpinner = ora('Building Node-loadable bundle...').start()
      try {
        const result = buildNodeBundle({ opensaasDir, configPath })
        nodeBuildSpinner.succeed(chalk.green('Node-loadable bundle built'))
        console.log(chalk.green(`✅ Node build emitted to ${path.relative(cwd, result.distDir)}`))

        // The Node build is best-effort (`noEmitOnError: false`): emit proceeds
        // even with stray type errors (e.g. the host's type-only `@/*` config
        // alias). Surface any errors as a warning rather than failing.
        const formattedErrors = formatNodeBuildDiagnostics(result.diagnostics)
        if (formattedErrors.trim().length > 0) {
          console.log(chalk.yellow('⚠️  Node build completed with type diagnostic(s) (non-fatal):'))
          console.log(chalk.gray(formattedErrors))
        }
      } catch (err) {
        nodeBuildSpinner.fail(chalk.red('Failed to build Node-loadable bundle'))
        const message = err instanceof Error ? err.message : String(err)
        console.error(chalk.red('\n❌ Error:'), message)
        process.exit(1)
      }
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
