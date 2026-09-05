import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import { getDbKey } from '@opensaas/stack-core'
import type { TypeDescriptor } from '@opensaas/stack-core/extend'
import { typeDescriptorToTypeString } from '@opensaas/stack-core/extend'
import * as fs from 'fs'
import * as path from 'path'

/**
 * The empty member of a `Remainder` entry. `Record<never, never>` rather than
 * an index-signature type: `keyof` it is `never`, so an empty `output` map
 * cannot accidentally `Omit` every column off the row.
 */
const EMPTY = 'Record<never, never>'

/**
 * Resolve the TypeScript type a field reads as, when it differs from its
 * column's codec type. A virtual field's `outputType` is already a resolved
 * string; a stored field's may be a descriptor. `resultExtension.outputType`
 * is the pre-ADR-0052 spelling, still honoured by the field packages that
 * have not moved yet (#1139).
 */
function readOutputType(field: FieldConfig): string | null {
  const declared: TypeDescriptor | undefined = field.outputType
  if (declared !== undefined) return typeDescriptorToTypeString(declared)
  if (field.resultExtension?.outputType) return field.resultExtension.outputType
  return null
}

function readInputType(field: FieldConfig): string | null {
  const declared: TypeDescriptor | undefined = field.inputType
  return declared === undefined ? null : typeDescriptorToTypeString(declared)
}

function isVirtual(field: FieldConfig): boolean {
  return field.type === 'virtual' || field.virtual === true
}

/**
 * Render `{ a: T; b: U }`, or the empty marker when there is nothing to say.
 */
function renderMembers(members: string[], indent: string): string {
  if (members.length === 0) return EMPTY
  return `{\n${members.map((m) => `${indent}  ${m}`).join('\n')}\n${indent}}`
}

/**
 * One list's contract remainder: the facts the emitted Contract artifacts
 * cannot carry (ADR-0052). Everything else about the list — scalar types,
 * nullability, relation arity, foreign-key ownership, column defaults — is
 * read from the contract by core's generics and is never written here.
 */
function generateRemainderEntry(
  listName: string,
  fields: Record<string, FieldConfig>,
  isSingleton: boolean,
): string {
  const computed: string[] = []
  const output: string[] = []
  const input: string[] = []

  for (const [fieldName, field] of Object.entries(fields)) {
    const outputType = readOutputType(field)
    if (isVirtual(field)) {
      // A virtual field has no column, so the contract has no type for it. An
      // `unknown` here would compile for every consumer and guard none of them,
      // so the missing declaration is reported instead.
      if (outputType === null) {
        throw new Error(
          `List "${listName}", field "${fieldName}": a virtual field must declare an ` +
            '`outputType` — there is no column for the contract to type it from.',
        )
      }
      computed.push(`${fieldName}: ${outputType}`)
      continue
    }
    if (outputType !== null) output.push(`${fieldName}: ${outputType}`)
    const inputType = readInputType(field)
    if (inputType !== null) input.push(`${fieldName}: ${inputType}`)
  }

  const needs = collectNeeds(fields).map(
    ([fieldName, keys]) => `${fieldName}: ${keys.map((k) => `'${k}'`).join(' | ')}`,
  )

  const lines = [
    `  ${listName}: {`,
    `    computed: ${renderMembers(computed, '    ')}`,
    `    output: ${renderMembers(output, '    ')}`,
    `    input: ${renderMembers(input, '    ')}`,
    `    needs: ${renderMembers(needs, '    ')}`,
  ]
  if (isSingleton) lines.push('    singleton: true')
  lines.push('  }')
  return lines.join('\n')
}

/**
 * Each computed field's declared dependency set. `pnpm generate` resolves the
 * set once and emits it twice — as data for the engine (#1137) and as the
 * type below — so the two cannot drift.
 */
export function collectNeeds(fields: Record<string, FieldConfig>): Array<[string, string[]]> {
  const entries: Array<[string, string[]]> = []
  for (const [fieldName, field] of Object.entries(fields)) {
    const declared = field.needs
    if (!declared || declared.length === 0) continue
    entries.push([fieldName, [...declared]])
  }
  return entries
}

/**
 * The bindings the module imports, each renamed into a namespace of its own.
 *
 * A list name is a config value under no naming rules beyond PascalCase, so a
 * list called `Row` or `Contract` would otherwise shadow the very generic its
 * own interface is declared from, and the emitted file would not compile with
 * nothing on the generator side to say why. `$` is not a legal character in a
 * list name, so no list can reach these — the same injective-prefix discipline
 * the Contract module applies to its model and enum bindings.
 */
function imported(name: string): string {
  return `Stack$${name}`
}

/** Every name the module declares that is not derived from a list name. */
const MODULE_NAMES = ['Remainder', 'DB', 'BaseContext', 'Context', 'TransactionContext'] as const

/**
 * The suffixes a list name is decorated with. Two distinct list names can still
 * land on one binding — `Post` and `PostList` both want `PostList` — which is
 * what {@link claimNames} refuses.
 */
const LIST_SUFFIXES = ['', 'StoredRow', 'CreateInput', 'UpdateInput', 'List'] as const

/**
 * Refuse a config whose lists and computed fields would have the module declare
 * one name twice, naming both origins. The alternative is an emitted file that
 * does not compile, with no generator-side error to explain it.
 */
function claimNames(config: OpenSaasConfig, needsFields: Array<[string, string]>): void {
  const claimed = new Map<string, string>()
  const claim = (name: string, origin: string): void => {
    const existing = claimed.get(name)
    if (existing !== undefined) {
      throw new Error(
        `The generated types would declare "${name}" twice: ${existing}, and ${origin}. ` +
          'Rename one of them.',
      )
    }
    claimed.set(name, origin)
  }

  for (const name of MODULE_NAMES) claim(name, `the bundle's own \`${name}\``)
  for (const listName of Object.keys(config.lists)) {
    for (const suffix of LIST_SUFFIXES) {
      claim(`${listName}${suffix}`, `list "${listName}"`)
    }
  }
  for (const [listName, fieldName] of needsFields) {
    claim(
      `${listName}${capitalize(fieldName)}NeedsItem`,
      `list "${listName}"'s computed field "${fieldName}"`,
    )
  }
}

/**
 * The named interfaces one list contributes. Each is a `interface X extends
 * Generic<Contract, Remainder, 'X'> {}` line, so TypeScript resolves it as its
 * own lazily-checked symbol (ADR-0032).
 */
function generateListInterfaces(listName: string): string {
  const key = `<${imported('Contract')}, Remainder, '${listName}'>`
  return [
    `export interface ${listName} extends ${imported('Row')}${key} {}`,
    `export interface ${listName}StoredRow extends ${imported('StoredRow')}${key} {}`,
    `export interface ${listName}CreateInput extends ${imported('CreateInput')}${key} {}`,
    `export interface ${listName}UpdateInput extends ${imported('UpdateInput')}${key} {}`,
    `export interface ${listName}List extends ${imported('SecuredList')}${key} {}`,
  ].join('\n')
}

function generateDbType(config: OpenSaasConfig): string {
  const lines: string[] = []
  lines.push('/**')
  lines.push(' * The access-controlled `db` surface, one member per list.')
  lines.push(' */')
  lines.push('export interface DB {')
  for (const listName of Object.keys(config.lists)) {
    lines.push(`  ${getDbKey(listName)}: ${listName}List`)
  }
  lines.push('}')
  return lines.join('\n')
}

function generateContextTypes(): string {
  const session = imported('Session')
  const services = imported('PluginServices')
  return `/**
 * The context a hook, an access rule and a plugin service see: the secured
 * \`db\`, the session and the ambient plumbing, with nothing that can start a
 * transaction or change who is asking.
 */
export interface BaseContext<TSession extends ${session} = ${session}>
  extends ${imported('StackBaseContext')}<DB, TSession, ${services}> {}

/**
 * The full context a server action or page component holds — everything
 * \`BaseContext\` carries plus \`sudo()\`, \`withSession()\` and \`transaction()\`.
 */
export interface Context<TSession extends ${session} = ${session}>
  extends ${imported('StackContext')}<DB, TSession, ${services}> {}

/**
 * The context inside \`context.transaction()\`.
 */
export interface TransactionContext<TSession extends ${session} = ${session}>
  extends ${imported('StackTransactionContext')}<DB, TSession, ${services}> {}`
}

/**
 * The relative specifier of the emitted `contract.d.ts` from `.opensaas/`.
 *
 * Spelled `.d.js`, not `.d.ts`: the Contract module (`prisma/contract.ts`)
 * sits in the same directory, and TypeScript resolves `./contract.d.ts` to
 * THAT file, so the import lands on the builder module and `Contract` is not
 * among its exports. `./contract.d.js` takes the standard `.js` -> `.d.ts`
 * mapping and reaches the emitted declarations. The import is type-only and
 * erased, so no loader ever sees the specifier — ADR-0054's `.ts` rule is
 * about value imports.
 */
const CONTRACT_IMPORT = '../prisma/contract.d.js'

export function generateTypes(config: OpenSaasConfig): string {
  const listNames = Object.keys(config.lists)
  const needsFields: Array<[string, string]> = Object.entries(config.lists).flatMap(
    ([listName, listConfig]) =>
      collectNeeds(listConfig.fields).map(([fieldName]): [string, string] => [listName, fieldName]),
  )
  claimNames(config, needsFields)

  const lines: string[] = []

  lines.push('/**')
  lines.push(' * Generated types from OpenSaas configuration')
  lines.push(' * DO NOT EDIT - This file is automatically generated')
  lines.push(' *')
  lines.push(' * This file declares the CONTRACT REMAINDER — the per-list facts the')
  lines.push(' * emitted Contract artifacts cannot carry — and instantiates the generics')
  lines.push(' * `@opensaas/stack-core` exports, keyed by the emitted `Contract`. Scalar')
  lines.push(' * types, nullability, relation arity and column defaults are read from the')
  lines.push(' * contract and are never written here. See ADR-0052.')
  lines.push(' */')
  lines.push('')

  // Only what is used is imported: a project compiling `.opensaas/` under
  // `noUnusedLocals` cannot edit generated code to silence it.
  const coreImports = ['Session', 'StackBaseContext', 'StackContext', 'StackTransactionContext']
  if (listNames.length > 0) {
    coreImports.push('CreateInput', 'Row', 'SecuredList', 'StoredRow', 'UpdateInput')
    lines.push(`import type { Contract as ${imported('Contract')} } from '${CONTRACT_IMPORT}'`)
  }
  if (needsFields.length > 0) coreImports.push('NeedsRow')
  lines.push('import type {')
  for (const name of coreImports.sort()) {
    lines.push(`  ${name} as ${imported(name)},`)
  }
  lines.push("} from '@opensaas/stack-core'")
  lines.push(
    `import type { PluginServices as ${imported('PluginServices')} } from './plugin-types.ts'`,
  )
  lines.push('')

  lines.push('/**')
  lines.push(' * The contract remainder, one entry per list:')
  lines.push(' *')
  lines.push(' * - `computed` — a virtual field, which has no column to type it from')
  lines.push(' * - `output` / `input` — a stored field whose TypeScript face differs')
  lines.push(' *   from its codec (`password` reads as `HashedPassword`)')
  lines.push(' * - `needs` — each computed field’s declared dependency set')
  lines.push(' * - `singleton` — a config fact the contract cannot see')
  lines.push(' */')
  lines.push('export type Remainder = {')
  const remainderEntries = Object.entries(config.lists).map(([listName, listConfig]) =>
    generateRemainderEntry(listName, listConfig.fields, !!listConfig.isSingleton),
  )
  lines.push(remainderEntries.join('\n'))
  lines.push('}')
  lines.push('')

  for (const listName of listNames) {
    lines.push(generateListInterfaces(listName))
    lines.push('')
  }

  // The declared-dependency item types `lists.ts` hands each hook. Named here
  // rather than inlined so `lists.ts` stays a namespace of references.
  const needsInterfaces = needsFields.map(
    ([listName, fieldName]) =>
      `export interface ${listName}${capitalize(fieldName)}NeedsItem` +
      ` extends ${imported('NeedsRow')}<${imported('Contract')}, Remainder, '${listName}', Remainder['${listName}']['needs']['${fieldName}']> {}`,
  )
  if (needsInterfaces.length > 0) {
    lines.push('/**')
    lines.push(' * What each computed field’s `resolveOutput` hook is handed: its declared')
    lines.push(' * dependency set plus the list’s system fields, and nothing else.')
    lines.push(' */')
    lines.push(needsInterfaces.join('\n'))
    lines.push('')
  }

  lines.push(generateDbType(config))
  lines.push('')
  lines.push(generateContextTypes())

  return lines.join('\n')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function writeTypes(config: OpenSaasConfig, outputPath: string): void {
  const types = generateTypes(config)

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, types, 'utf-8')
}
