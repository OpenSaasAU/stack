import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import {
  emitContract,
  seedExtensionContractSpaces,
  verifyExtensionSubpaths,
  writeContractModule,
  writePrismaConfig,
  writeTypes,
  writeLists,
  writeContext,
  writePluginTypes,
  writeTables,
  resolveOutputPaths,
  stageWritePaths,
  loadOpenSaasConfig,
} from '../generator/index.js'
import type { ResolvedWritePaths } from '../generator/index.js'
import {
  OpenSaasConfig,
  assertRelationGraphAgrees,
  deriveContract,
  deriveGeneratedTables,
  validateConfigFields,
  validateNeedsDeclarations,
  validateDatabaseConfig,
  validateRelations,
} from '@opensaas/stack-core'
import type {
  ConfigRefusal,
  ContractData,
  EmittedContract,
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
 * message — an entry naming nothing on the list or naming a computed field,
 * or a declaration on a field with no hook to consume it — each naming the
 * offending field.
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

/**
 * A refusal generation has already reported in full. Thrown only when the
 * caller asked for it: `opensaas generate` still exits on one, and the dev
 * loop catches it and keeps serving.
 */
export class GenerationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationFailedError'
  }
}

/** Options for {@link generateCommand}. */
export interface GenerateCommandOptions {
  /**
   * Write the Contract module, its emitted artifacts and the bundle under this
   * directory instead of their resolved homes, so a generation can be planned
   * against the database before the app is allowed to load it (ADR-0063). The
   * project-root `prisma.config.ts` is written in place either way — nothing
   * the app loads reads it.
   */
  stagingDir?: string
  /**
   * Throw a {@link GenerationFailedError} rather than exiting the process, so
   * a caller with something to keep alive survives a refusal.
   */
  throwOnFailure?: boolean
}

/** Where one generation put its files, and how to point Prisma at them. */
export interface GenerationResult {
  /** Absolute path of every file this generation wrote. */
  paths: ResolvedWritePaths
  /**
   * Where those files belong — the same set as `paths` unless the generation
   * was staged, in which case this is what promoting it writes over.
   */
  livePaths: ResolvedWritePaths
  /** The Prisma config a CLI command must read to see this generation. */
  prismaConfig: string
}

export async function generateCommand(
  options: GenerateCommandOptions = {},
): Promise<GenerationResult> {
  try {
    return await runGeneration(options)
  } catch (error) {
    if (options.throwOnFailure === true) throw error
    process.exit(1)
  }
}

async function runGeneration(options: GenerateCommandOptions): Promise<GenerationResult> {
  console.log(chalk.bold('\n🚀 OpenSaas Generator\n'))

  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('❌ Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    throw new GenerationFailedError('opensaas.config.ts not found')
  }

  const spinner = ora('Loading configuration...').start()

  try {
    const { config: loaded, aliasWarnings } = await loadOpenSaasConfig(cwd, configPath)
    let config: OpenSaasConfig = loaded

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
      throw new GenerationFailedError('field configuration invalid')
    }
    validationSpinner.succeed(chalk.green('Field configuration valid'))

    // Validate `needs` declarations (ADR-0025) up front too: an entry naming
    // nothing on the list, or a declaration nothing can consume, must fail
    // generation rather than be silently ignored at runtime.
    const needsSpinner = ora('Validating declared dependencies...').start()
    const needsErrors = validateNeedsDeclarations(config)
    if (needsErrors.length > 0) {
      needsSpinner.fail(chalk.red('Declared dependencies invalid'))
      console.error(chalk.red('\n❌ Error:'), formatNeedsClosureErrors(needsErrors))
      throw new GenerationFailedError('declared dependencies invalid')
    }
    needsSpinner.succeed(chalk.green('Declared dependencies valid'))

    const surfaceSpinner = ora('Validating config surface...').start()
    const refusals = [...validateDatabaseConfig(config), ...validateRelations(config)]
    if (refusals.length > 0) {
      surfaceSpinner.fail(chalk.red('Config surface invalid'))
      console.error(chalk.red('\n❌ Error:'), formatConfigRefusals(refusals))
      throw new GenerationFailedError('config surface invalid')
    }
    surfaceSpinner.succeed(chalk.green('Config surface valid'))

    const deriveSpinner = ora('Deriving the contract...').start()
    let contractData: ContractData
    try {
      contractData = deriveContract(config)
      deriveSpinner.succeed(chalk.green('Contract derived'))
    } catch (err) {
      deriveSpinner.fail(chalk.red('Failed to derive the contract'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      throw new GenerationFailedError('contract derivation failed')
    }

    // Ahead of the writes: prisma.config.ts and the Contract module both
    // import a declared pack's subpaths, so a refusal after them would leave
    // the project carrying an unresolvable import.
    const packSpinner = ora('Resolving declared extension packs...').start()
    try {
      verifyExtensionSubpaths(cwd, contractData)
      packSpinner.succeed(chalk.green('Declared extension packs resolved'))
    } catch (err) {
      packSpinner.fail(chalk.red('Declared extension pack unresolvable'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      throw new GenerationFailedError('declared extension pack unresolvable')
    }

    const { paths: resolved, crossReferences } = resolveOutputPaths(
      cwd,
      config.output,
      config.opensaasPath,
    )
    const staging = options.stagingDir
    const paths = staging === undefined ? resolved : stageWritePaths(resolved, staging)

    const generatorSpinner = ora('Writing the Contract module and prisma.config.ts...').start()
    try {
      writeContractModule(contractData, paths.contractModule)
      writePrismaConfig(contractData, resolved.prismaConfig, {
        contractModule: crossReferences.prismaConfigContract,
        outputDir: crossReferences.prismaConfigOutput,
      })
      if (staging !== undefined) {
        // The staged config names absolute paths and the project's own
        // migrations directory: `db update --to` takes a ref or a migration
        // directory rather than a contract file, so pointing the CLI at a
        // staged contract means pointing it at a config that reads one — and
        // it has to share the graph the project's refs live in, not start a
        // private one beside itself (ADR-0063).
        writePrismaConfig(contractData, paths.prismaConfig, {
          contractModule: paths.contractModule,
          outputDir: paths.contractDir,
          migrationsDir: path.join(cwd, 'migrations'),
          envDir: cwd,
        })
      }

      generatorSpinner.succeed(chalk.green('Contract module written'))
      console.log(chalk.green('✅ Contract module generated'))
      console.log(chalk.green('✅ Prisma config generated'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      generatorSpinner.fail(chalk.red('Failed to write the Contract module'))
      console.error(chalk.red('\n❌ Error:'), err.message)
      if (err.stack) {
        console.error(chalk.gray('\n' + err.stack))
      }
      throw new GenerationFailedError('the Contract module was not written')
    }

    // One computation, three consumers: the emitted `tables.ts` the runtime
    // widens a read from, and the `Remainder`'s per-field `needs` type the
    // bundle renders it as (#1136). Derived once so the type and the runtime
    // widening cannot disagree (ADR-0051).
    const generatedTables = deriveGeneratedTables(config, contractData)

    const bundleSpinner = ora('Generating the bundle...').start()
    try {
      writeTypes(config, paths.types, generatedTables.dependencies)
      writeLists(config, paths.lists, generatedTables.dependencies)
      writeTables(generatedTables, paths.tables)
      writeContext(config, contractData, paths.context, {
        configImport: crossReferences.configImport,
        contractJsonImport: crossReferences.contractJsonImport,
      })
      writePluginTypes(config, paths.pluginTypes)

      bundleSpinner.succeed(chalk.green('Bundle generation complete'))
      console.log(chalk.green('✅ TypeScript types generated'))
      console.log(chalk.green('✅ Lists namespace generated'))
      console.log(chalk.green('✅ Dependency-set table and constraint map generated'))
      console.log(chalk.green('✅ Context factory generated'))
      console.log(chalk.green('✅ Plugin types generated'))

      if (config.plugins && config.plugins.length > 0) {
        const afterGenSpinner = ora('Running plugin afterGenerate hooks...').start()

        try {
          const generatedFiles = {
            contractModule: fs.readFileSync(paths.contractModule, 'utf-8'),
            types: fs.readFileSync(paths.types, 'utf-8'),
            context: fs.readFileSync(paths.context, 'utf-8'),
          }

          const { executeAfterGenerateHooks } =
            await import('@opensaas/stack-core/config/plugin-engine')
          const modifiedFiles = await executeAfterGenerateHooks(config, generatedFiles)

          if (modifiedFiles.contractModule !== generatedFiles.contractModule) {
            fs.writeFileSync(paths.contractModule, modifiedFiles.contractModule)
          }
          if (modifiedFiles.types !== generatedFiles.types) {
            fs.writeFileSync(paths.types, modifiedFiles.types)
          }
          if (modifiedFiles.context !== generatedFiles.context) {
            fs.writeFileSync(paths.context, modifiedFiles.context)
          }

          for (const [filename, content] of Object.entries(modifiedFiles)) {
            if (!['contractModule', 'types', 'context'].includes(filename)) {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      bundleSpinner.fail(chalk.red('Failed to generate the bundle'))
      console.error(chalk.red('\n❌ Error:'), err.message)
      if (err.stack) {
        console.error(chalk.gray('\n' + err.stack))
      }
      throw new GenerationFailedError('bundle generation failed')
    }

    // Extension contract spaces are seeded between the Contract module and
    // emission (ADR-0065), so `contract emit` and every later `db` command
    // read a migrations directory that already carries each declared pack's
    // space.
    const seedSpinner = ora('Seeding extension contract spaces...').start()
    try {
      const { seeded } = await seedExtensionContractSpaces(cwd, contractData)
      seedSpinner.succeed(chalk.green('Extension contract spaces seeded'))
      for (const space of seeded) {
        console.log(chalk.green(`✅ ${space.pack}: migrations/${space.spaceId} ${space.action}`))
      }
    } catch (err) {
      seedSpinner.fail(chalk.red('Failed to seed extension contract spaces'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      throw new GenerationFailedError('extension contract spaces were not seeded')
    }

    // Emission runs after `afterGenerate`, so a plugin's rewrite of the
    // Contract module is what the artifacts and the agreement gate below
    // describe. Emitting first would commit a contract.json for the pre-hook
    // module and leave it silently disagreeing with the checked-in
    // contract.ts.
    const emitSpinner = ora('Emitting contract artifacts...').start()
    try {
      await emitContract(
        cwd,
        paths.contractDir,
        staging === undefined ? undefined : paths.prismaConfig,
      )
      emitSpinner.succeed(chalk.green('Contract artifacts emitted'))
      console.log(chalk.green(`✅ ${path.relative(cwd, paths.contractJson)} emitted`))
      console.log(chalk.green(`✅ ${path.relative(cwd, paths.contractTypes)} emitted`))
    } catch (err) {
      emitSpinner.fail(chalk.red('Failed to emit contract artifacts'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      throw new GenerationFailedError('contract emission failed')
    }

    // Reading the artifact is its own failure: a missing or unparseable
    // contract.json means emission did not put it where the resolved paths say
    // it is, which is not the same problem as a config the emitted graph
    // disagrees with.
    let emitted: EmittedContract
    try {
      emitted = JSON.parse(fs.readFileSync(paths.contractJson, 'utf-8'))
    } catch (err) {
      console.error(
        chalk.red('\n❌ Error:'),
        `Could not read the emitted contract at ${path.relative(cwd, paths.contractJson)}. ` +
          '`prisma contract emit` reported success, so it wrote its artifacts elsewhere or ' +
          'wrote them unparseably.',
      )
      console.error(chalk.gray(err instanceof Error ? err.message : String(err)))
      throw new GenerationFailedError('the emitted contract could not be read')
    }

    // The emitted contract is the artifact the runtime executes, so the last
    // gate is that its relation graph is the one the config describes — a
    // divergence is a build error, not a query-time Prisma rejection.
    const agreementSpinner = ora('Checking the emitted relation graph...').start()
    try {
      assertRelationGraphAgrees(contractData, emitted)
      agreementSpinner.succeed(chalk.green('Emitted relation graph agrees with the config'))
    } catch (err) {
      agreementSpinner.fail(chalk.red('Emitted relation graph disagrees with the config'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      throw new GenerationFailedError('the emitted relation graph disagrees with the config')
    }

    console.log(chalk.bold('\n✨ Generation complete!\n'))
    if (staging === undefined) {
      console.log(chalk.gray('Next steps:'))
      console.log(chalk.gray('  1. Commit prisma/contract.json and prisma/contract.d.ts'))
      console.log(chalk.gray('  2. Run: npx prisma db update'))
      console.log(chalk.gray('  3. Start using your generated types!\n'))
    }

    return { paths, livePaths: resolved, prismaConfig: paths.prismaConfig }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error instanceof GenerationFailedError) throw error
    spinner.fail(chalk.red('Generation failed'))
    console.error(chalk.red('\n❌ Error:'), error.message)
    if (error.stack) {
      console.error(chalk.gray('\n' + error.stack))
    }
    throw new GenerationFailedError(error.message)
  }
}
