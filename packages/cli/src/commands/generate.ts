import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { createJiti } from 'jiti'
import {
  emitContract,
  seedExtensionContractSpaces,
  writeContractModule,
  writePrismaConfig,
  writeTypes,
  writeLists,
  writeContext,
  writePluginTypes,
  writeTables,
  resolveOutputPaths,
  buildNodeBundle,
  formatNodeBuildDiagnostics,
  resolveTsconfigAlias,
} from '../generator/index.js'
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

    // Validate `needs` declarations (ADR-0025) up front too: an entry naming
    // nothing on the list, or a declaration nothing can consume, must fail
    // generation rather than be silently ignored at runtime.
    const needsSpinner = ora('Validating declared dependencies...').start()
    const needsErrors = validateNeedsDeclarations(config)
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

    const deriveSpinner = ora('Deriving the contract...').start()
    let contractData: ContractData
    try {
      contractData = deriveContract(config)
      deriveSpinner.succeed(chalk.green('Contract derived'))
    } catch (err) {
      deriveSpinner.fail(chalk.red('Failed to derive the contract'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    // Captured here so the (optional) Node build step, which runs after
    // emission outside this try block, knows where the bundle lives.
    let opensaasDir = ''
    const { paths, crossReferences } = resolveOutputPaths(cwd, config.output, config.opensaasPath)
    const generatorSpinner = ora('Writing the Contract module and prisma.config.ts...').start()
    try {
      opensaasDir = paths.opensaasDir

      writeContractModule(contractData, paths.contractModule)
      writePrismaConfig(contractData, paths.prismaConfig, {
        contractModule: crossReferences.prismaConfigContract,
        outputDir: crossReferences.prismaConfigOutput,
      })

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
      process.exit(1)
    }

    const bundleSpinner = ora('Generating the bundle...').start()
    try {
      writeTypes(config, paths.types)
      writeLists(config, paths.lists)
      writeTables(deriveGeneratedTables(config, contractData), paths.tables)
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
      process.exit(1)
    }

    // Extension contract spaces are seeded between the Contract module and
    // emission (ADR-0065). #1135 fills this in; today it is a no-op.
    seedExtensionContractSpaces(cwd, contractData)

    // Emission runs after `afterGenerate`, so a plugin's rewrite of the
    // Contract module is what the artifacts and the agreement gate below
    // describe. Emitting first would commit a contract.json for the pre-hook
    // module and leave it silently disagreeing with the checked-in
    // contract.ts.
    const emitSpinner = ora('Emitting contract artifacts...').start()
    try {
      emitContract(cwd, paths.contractDir)
      emitSpinner.succeed(chalk.green('Contract artifacts emitted'))
      console.log(chalk.green(`✅ ${path.relative(cwd, paths.contractJson)} emitted`))
      console.log(chalk.green(`✅ ${path.relative(cwd, paths.contractTypes)} emitted`))
    } catch (err) {
      emitSpinner.fail(chalk.red('Failed to emit contract artifacts'))
      console.error(chalk.red('\n❌ Error:'), err instanceof Error ? err.message : String(err))
      process.exit(1)
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
      process.exit(1)
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
      process.exit(1)
    }

    // Optional Node build (ADR-0011): when `output.buildTarget === 'node'`,
    // additionally compile the `.ts` bundle to a plain-Node-loadable ESM form
    // under `<opensaasDir>/dist/` so a live module (e.g. better-auth's adapter)
    // can be imported in a bundler-less runtime. Purely additive — the default
    // `.ts` form is untouched.
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
    console.log(chalk.gray('  1. Commit prisma/contract.json and prisma/contract.d.ts'))
    console.log(chalk.gray('  2. Run: npx prisma db update'))
    console.log(chalk.gray('  3. Start using your generated types!\n'))
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
