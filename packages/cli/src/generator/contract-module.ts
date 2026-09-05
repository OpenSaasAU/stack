import * as fs from 'fs'
import * as path from 'path'
import type {
  ContractColumn,
  ContractData,
  ContractIdColumn,
  ContractModel,
  ExtensionDescriptor,
} from '@opensaas/stack-core'

/**
 * The column-type helpers the rendered module imports from
 * `@prisma/orm-postgres/adapter/column-types`, in the order they are emitted.
 * Only the ones a given contract actually reaches are imported.
 */
const COLUMN_TYPE_HELPERS = [
  'charColumn',
  'dateStringColumn',
  'float4Column',
  'int2Column',
  'jsonColumn',
  'numericColumn',
  'timeStringColumn',
  'timestampStringColumn',
  'timestamptzStringColumn',
  'varcharColumn',
] as const

type ColumnTypeHelper = (typeof COLUMN_TYPE_HELPERS)[number]

/** A rendered expression plus the module-level imports it needs. */
type Rendered = {
  expression: string
  helpers: ColumnTypeHelper[]
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** A single-quoted TypeScript string, matching the repo's own source style. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** JSON literals are the whole vocabulary a contract carries (ADR-0040). */
function literal(value: unknown): string {
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) return `[${value.map((entry) => literal(entry)).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([name, entry]) => `${key(name)}: ${literal(entry)}`)
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(value)
}

/**
 * A TypeScript object key, quoted only when it is not a plain identifier, so
 * the common case reads as hand-written source.
 */
function key(name: string): string {
  return IDENTIFIER.test(name) ? name : quote(name)
}

/** A member access on the builder's `cols`/`fields` helper record. */
function member(record: string, name: string): string {
  return IDENTIFIER.test(name) ? `${record}.${name}` : `${record}[${quote(name)}]`
}

function numberArg(args: readonly unknown[] | undefined, index: number): number | undefined {
  const value = args?.[index]
  return typeof value === 'number' ? value : undefined
}

function argList(args: readonly unknown[] | undefined): string {
  return (args ?? []).map((arg) => literal(arg)).join(', ')
}

/**
 * The identifier a native enum is bound to at module scope. Enum names come
 * from a `select({ db: { type: 'enum' } })` field, so they can collide with a
 * model name; the suffix keeps the two apart.
 */
function enumBinding(name: string): string {
  return `${name}Enum`
}

/**
 * The `field.*` call for one `pg`-pack column type — the rendered twin of
 * `buildPrismaContract`'s `pgColumn`.
 */
function pgColumnExpression(model: string, column: ContractColumn): Rendered {
  const { type } = column
  switch (type.type) {
    case 'text':
      return { expression: 'field.text()', helpers: [] }
    case 'varchar': {
      const length = numberArg(type.args, 0)
      if (length === undefined) {
        throw new Error(`Model "${model}", column "${column.name}": a varchar column needs a length`)
      }
      return { expression: `field.column(varcharColumn(${length}))`, helpers: ['varcharColumn'] }
    }
    case 'char': {
      const length = numberArg(type.args, 0)
      if (length === undefined) {
        throw new Error(`Model "${model}", column "${column.name}": a char column needs a length`)
      }
      return { expression: `field.column(charColumn(${length}))`, helpers: ['charColumn'] }
    }
    case 'int':
      return { expression: 'field.int()', helpers: [] }
    case 'smallint':
      return { expression: 'field.column(int2Column)', helpers: ['int2Column'] }
    case 'bigint':
      return { expression: 'field.bigint()', helpers: [] }
    case 'decimal': {
      const precision = numberArg(type.args, 0)
      if (precision === undefined) return { expression: 'field.decimal()', helpers: [] }
      const scale = numberArg(type.args, 1)
      const args = scale === undefined ? `${precision}` : `${precision}, ${scale}`
      return { expression: `field.column(numericColumn(${args}))`, helpers: ['numericColumn'] }
    }
    case 'float':
      return { expression: 'field.float()', helpers: [] }
    case 'real':
      return { expression: 'field.column(float4Column)', helpers: ['float4Column'] }
    case 'boolean':
      return { expression: 'field.boolean()', helpers: [] }
    case 'dateTime':
    case 'timestamptz':
      return withPrecision('timestamptzStringColumn', numberArg(type.args, 0))
    case 'timestamp':
      return withPrecision('timestampStringColumn', numberArg(type.args, 0))
    case 'time': {
      const precision = numberArg(type.args, 0)
      const args = precision === undefined ? '' : `${precision}`
      return {
        expression: `field.column(timeStringColumn(${args}))`,
        helpers: ['timeStringColumn'],
      }
    }
    case 'date':
      return { expression: 'field.column(dateStringColumn)', helpers: ['dateStringColumn'] }
    case 'uuid':
      return { expression: 'field.uuidNative()', helpers: [] }
    case 'json':
      return { expression: 'field.column(jsonColumn)', helpers: ['jsonColumn'] }
    case 'jsonb':
      return { expression: 'field.json()', helpers: [] }
    case 'bytes':
      return { expression: 'field.bytes()', helpers: [] }
    case 'enum': {
      const name = column.enum?.name
      if (name === undefined) {
        throw new Error(
          `Model "${model}", column "${column.name}": enum column names no declared enum`,
        )
      }
      return { expression: `field.column(pg.enum(${enumBinding(name)}))`, helpers: [] }
    }
    default:
      throw new Error(
        `Model "${model}", column "${column.name}": the Postgres pack has no type "${type.type}"`,
      )
  }
}

/**
 * rc.8's `timestamp`/`timestamptz` descriptors are constants with no
 * precision parameter; the codec behind each takes `typeParams.precision`, so
 * a precision is spread onto the constant.
 */
function withPrecision(helper: ColumnTypeHelper, precision: number | undefined): Rendered {
  const expression =
    precision === undefined
      ? `field.column(${helper})`
      : `field.column({ ...${helper}, typeParams: { precision: ${precision} } })`
  return { expression, helpers: [helper] }
}

function columnExpression(model: string, column: ContractColumn): Rendered {
  const base =
    column.type.pack === 'pg'
      ? pgColumnExpression(model, column)
      : {
          expression: `field.column(type.${column.type.pack}.${column.type.type}(${argList(column.type.args)}))`,
          helpers: [] as ColumnTypeHelper[],
        }

  let expression = base.expression
  if (column.nullable) expression += '.optional()'
  if (column.map !== undefined) expression += `.column(${literal(column.map)})`
  if (column.unique) expression += '.unique()'
  if (column.default?.kind === 'literal') expression += `.default(${literal(column.default.value)})`
  if (column.default?.kind === 'now') expression += `.defaultSql('now()')`
  return { expression, helpers: base.helpers }
}

function idExpression(id: ContractIdColumn): string {
  switch (id.strategy) {
    case 'uuid7':
      return 'field.id.uuidv7Native()'
    case 'cuid2':
      return 'field.id.cuid2()'
    case 'int autoincrement':
      return `field.int().defaultSql('autoincrement()').id()`
    case 'singleton':
      return 'field.int().default(1).id()'
  }
}

function relationExpression(relation: ContractModel['relations'][number]): string {
  const target = `() => models.${relation.target}`
  return relation.kind === 'belongsTo'
    ? `rel.belongsTo(${target}, { from: ${literal(relation.column)}, to: 'id' })`
    : `rel.${relation.kind}(${target}, { by: ${literal(relation.column)} })`
}

/** The `const <Model> = model(...)` declaration, relations included. */
function renderModelDeclaration(model: ContractModel, helpers: Set<ColumnTypeHelper>): string {
  const fields: string[] = [`        id: ${idExpression(model.id)},`]
  for (const column of model.columns) {
    const rendered = columnExpression(model.name, column)
    for (const helper of rendered.helpers) helpers.add(helper)
    fields.push(`        ${key(column.name)}: ${rendered.expression},`)
  }
  if (model.timestamps.createdAt) {
    fields.push('        createdAt: field.temporal.createdAtString(),')
  }
  if (model.timestamps.updatedAt) {
    fields.push('        updatedAt: field.temporal.updatedAtString(),')
  }

  const lines = [`    const ${model.name} = (models.${model.name} = model(${literal(model.name)}, {`]
  lines.push('      fields: {', ...fields, '      },')
  if (model.relations.length === 0) {
    lines.push('      relations: {},')
  } else {
    lines.push('      relations: {')
    for (const relation of model.relations) {
      lines.push(`        ${key(relation.name)}: ${relationExpression(relation)},`)
    }
    lines.push('      },')
  }
  if (model.namespace !== undefined) {
    lines.push(`      namespace: ${literal(model.namespace)},`)
  }
  lines.push('    }))')
  return lines.join('\n')
}

/**
 * The `.attributes(...).sql(...)` tail, rendered for the `models:` record the
 * `defineContract` callback returns. Both calls are always emitted so the
 * rendered module and `buildPrismaContract` reach the builder identically.
 */
function renderModelAttributes(model: ContractModel): string {
  const uniques = model.indexes.filter((index) => index.unique)
  const plainIndexes = model.indexes.filter((index) => !index.unique)
  const indexedColumns = model.columns.filter((column) => column.index)

  const uniqueEntries = uniques.map((index) => {
    const columns = index.columns.map((column) => member('fields', column)).join(', ')
    const options = index.name !== undefined ? `, { name: ${literal(index.name)} }` : ', {}'
    return `constraints.unique([${columns}]${options}),`
  })

  const indexEntries = [
    ...indexedColumns.map((column) => `constraints.index([${member('cols', column.name)}]),`),
    ...plainIndexes.map((index) => {
      const columns = index.columns.map((column) => member('cols', column)).join(', ')
      const options = index.name !== undefined ? `, { map: ${literal(index.name)} }` : ''
      return `constraints.index([${columns}]${options}),`
    }),
  ]

  const foreignKeyEntries = model.foreignKeys.map((fk) => {
    const options = ['index: false']
    if (fk.onDelete !== undefined) options.push(`onDelete: ${literal(fk.onDelete)}`)
    if (fk.onUpdate !== undefined) options.push(`onUpdate: ${literal(fk.onUpdate)}`)
    return `constraints.foreignKey(${member('cols', fk.column)}, ${fk.references.model}.refs.id, { ${options.join(', ')} }),`
  })

  /** `key: []`, or the entries one per line under it. */
  function block(name: string, entries: string[]): string[] {
    if (entries.length === 0) return [`          ${name}: [],`]
    return [`          ${name}: [`, ...entries.map((entry) => `            ${entry}`), '          ],']
  }

  const lines: string[] = []
  const uniqueParams = uniqueEntries.length > 0 ? '({ fields, constraints })' : '()'
  lines.push(`        ${key(model.name)}: ${model.name}.attributes(${uniqueParams} => ({`)
  lines.push(...block('uniques', uniqueEntries))

  const usesSqlHelpers = indexEntries.length > 0 || foreignKeyEntries.length > 0
  const sqlParams = usesSqlHelpers ? '({ cols, constraints })' : '()'
  lines.push(`        })).sql(${sqlParams} => ({`)
  if (model.table !== undefined) {
    lines.push(`          table: ${literal(model.table)},`)
  }
  lines.push(...block('indexes', indexEntries))
  lines.push(...block('foreignKeys', foreignKeyEntries))
  lines.push('        })),')
  return lines.join('\n')
}

/**
 * The pack's `/pack` subpath, re-emitted from the descriptor's `from` package
 * name (ADR-0049). The module imports the pack value; nothing is serialised
 * out of the config.
 */
function packSubpath(extension: ExtensionDescriptor): string {
  return `${extension.from}/pack`
}

/**
 * Render the standalone Contract module — `prisma/contract.ts` — from core's
 * derivation (ADR-0040, ADR-0057).
 *
 * The module imports only from `@prisma/orm-postgres/contract-builder`,
 * `@prisma/orm-postgres/adapter/column-types` and each declared extension
 * pack's `/pack` subpath. It imports nothing from `opensaas.config.ts`, reads
 * no environment variable and contains no non-literal expression, so it
 * satisfies Prisma's purity rules by construction and `prisma contract emit`
 * can evaluate it on its own.
 *
 * Every builder call is the one {@link buildPrismaContract} makes for the same
 * data, so the rendered module and the in-process derivation emit identical
 * contract JSON — the equivalence test that keeps the two from drifting.
 *
 * @example
 * ```typescript
 * import { deriveContract } from '@opensaas/stack-core'
 * fs.writeFileSync('prisma/contract.ts', renderContractModule(deriveContract(config)))
 * ```
 *
 * Known limits:
 * - A model, relation, column or enum name must be a valid TypeScript
 *   identifier where the module binds one (models and enums become `const`
 *   declarations); the config surface's own validation is what keeps those
 *   names well-formed, and this renderer does not re-check them.
 * - The emitted relation targets are thunks (`() => Target`), so a model may
 *   reference one declared later, but every target must be a model in the
 *   same contract — cross-space references are not rendered.
 * - An extension pack's type constructor is emitted as
 *   `type.<pack>.<type>(...)` with the descriptor's literal arguments; the
 *   renderer does not know the pack's constructor list, so a misspelled type
 *   surfaces at `contract emit` rather than here.
 */
export function renderContractModule(data: ContractData): string {
  const helpers = new Set<ColumnTypeHelper>()

  const declarations = data.models.map((model) => renderModelDeclaration(model, helpers))
  const attributes = data.models.map((model) => renderModelAttributes(model))

  const usesEnums = data.enums.length > 0
  const builderImports = ['defineContract']
  if (usesEnums) builderImports.push('nativeEnum', 'pg')

  const lines: string[] = []
  lines.push('// ⚠️  GENERATED FILE - DO NOT EDIT')
  lines.push("// Generated by 'opensaas generate' from opensaas.config.ts.")
  lines.push('')
  lines.push(
    `import { ${builderImports.join(', ')} } from '@prisma/orm-postgres/contract-builder'`,
  )
  lines.push(
    "import type { ScalarFieldBuilder } from '@prisma/orm-postgres/contract-builder'",
  )
  const usedHelpers = COLUMN_TYPE_HELPERS.filter((helper) => helpers.has(helper))
  if (usedHelpers.length > 0) {
    lines.push(
      `import { ${usedHelpers.join(', ')} } from '@prisma/orm-postgres/adapter/column-types'`,
    )
  }
  for (const extension of data.extensions) {
    lines.push(`import ${extension.name} from '${packSubpath(extension)}'`)
  }
  lines.push('')

  // A relation target is resolved when the contract is lowered, not when the
  // model is declared, so every target is routed through a record rather than
  // named directly — `rel.belongsTo` reads its target eagerly, which a `const`
  // declared later (or the model itself) cannot satisfy. This is the shape the
  // relation builders accept; the per-model `const` keeps the precise type
  // where a foreign key needs it.
  lines.push('type ModelToken = {')
  lines.push('  readonly stageOne: {')
  lines.push('    readonly modelName?: string')
  lines.push('    readonly fields: Record<string, ScalarFieldBuilder>')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  for (const declared of data.enums) {
    const values = declared.values.map((value) => literal(value)).join(', ')
    lines.push(
      `const ${enumBinding(declared.name)} = nativeEnum(${literal(declared.name)}, ${values})`,
    )
  }
  if (usesEnums) lines.push('')

  const scaffold: string[] = []
  const packNames = data.extensions.map((extension) => extension.name)
  scaffold.push(packNames.length === 0 ? 'extensions: {}' : `extensions: { ${packNames.join(', ')} }`)
  if (data.namespaces.length > 0) {
    scaffold.push(`namespaces: [${data.namespaces.map((ns) => literal(ns)).join(', ')}]`)
  }

  const usesTypeHelper = data.models.some((model) =>
    model.columns.some((column) => column.type.pack !== 'pg'),
  )
  const usesRelHelper = data.models.some((model) => model.relations.length > 0)
  const callbackParams = ['field', 'model']
  if (usesRelHelper) callbackParams.push('rel')
  if (usesTypeHelper) callbackParams.push('type')

  lines.push('export const contract = defineContract(')
  lines.push(`  { ${scaffold.join(', ')} },`)
  lines.push(`  ({ ${callbackParams.join(', ')} }) => {`)
  lines.push('    const models: Record<string, ModelToken> = {}')
  lines.push('')
  for (const declaration of declarations) {
    lines.push(declaration, '')
  }
  lines.push('    return {')
  lines.push('      models: {')
  lines.push(...attributes)
  lines.push('      },')
  lines.push('    }')
  lines.push('  },')
  lines.push(')')
  lines.push('')

  return lines.join('\n')
}

export function writeContractModule(data: ContractData, outputPath: string): void {
  const content = renderContractModule(data)

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content, 'utf-8')
}
