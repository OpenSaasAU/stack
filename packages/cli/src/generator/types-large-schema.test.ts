import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import type { OpenSaasConfig, ListConfig } from '@opensaas/stack-core'
import { text, integer, checkbox, json, relationship } from '@opensaas/stack-core/fields'

/**
 * Regression test for #952: the generated `Context`/`CustomDB` type must
 * type-check under `tsc --noEmit` for a realistically large schema (20
 * lists, a mix of scalar/json/relationship fields, and a relationship
 * chain that forces each list's generated `GetPayload<T>` to reference its
 * neighbours). Before the fix, this reliably hit
 * `TS2589: Type instantiation is excessively deep and possibly infinite`.
 */

const COMPILE_TIMEOUT_MS = 120_000
const LIST_COUNT = 20

function buildLargeSchemaConfig(): OpenSaasConfig {
  const lists: Record<string, ListConfig> = {
    Tenant: {
      fields: {
        name: text({ validation: { isRequired: true } }),
      },
    },
  }

  for (let i = 0; i < LIST_COUNT; i++) {
    const listName = `Model${i}`
    const prevListName = i === 0 ? null : `Model${i - 1}`
    const hasNext = i < LIST_COUNT - 1

    lists[listName] = {
      fields: {
        title: text({ validation: { isRequired: true } }),
        code: text(),
        priority: integer(),
        active: checkbox({ defaultValue: false }),
        metaA: json(),
        metaB: json(),
        tenant: relationship({ ref: 'Tenant' }),
        ...(prevListName
          ? { previous: relationship({ ref: `${prevListName}.next`, many: false }) }
          : {}),
        ...(hasNext ? { next: relationship({ ref: `Model${i + 1}.previous`, many: true }) } : {}),
      },
    }
  }

  return {
    db: { provider: 'postgresql' },
    lists,
  }
}

/**
 * Flat (non-conditional) Prisma stub: `XGetPayload<T>` ignores `T`, matching
 * the fixture pattern in types-write-narrowing.test.ts. This isolates the
 * test to OUR generated layer (CustomDB, per-list GetPayload conditional
 * chains, Context.sudo() self-reference) rather than re-implementing
 * Prisma's own deeply-conditional GetPayload machinery.
 */
function buildPrismaStub(config: OpenSaasConfig): string {
  const lines: string[] = [
    "import type { Decimal } from 'decimal.js'",
    '',
    'export class PrismaClient {}',
    '',
    'export namespace Prisma {',
    '  export type SelectSubset<T, U> = {',
    '    [key in keyof T]: key extends keyof U ? T[key] : never',
    '  } & U',
    '',
  ]

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const scalarFields = Object.entries(listConfig.fields).filter(
      ([, f]) => f.type !== 'relationship',
    )
    const relFields = Object.entries(listConfig.fields).filter((entry) => {
      const [, f] = entry
      return f.type === 'relationship'
    })

    const createMembers = scalarFields
      .map(([name]) => `${name}?: unknown`)
      .concat(
        relFields.map(([name]) => `${name}?: { connect: { id: string } | Array<{ id: string }> }`),
      )
      .join('; ')
    const selectMembers = Object.keys(listConfig.fields)
      .map((name) => `${name}?: boolean`)
      .join('; ')
    const includeMembers = relFields.map(([name]) => `${name}?: boolean`).join('; ')

    lines.push(`  export type ${listName}CreateInput = { ${createMembers} }`)
    lines.push(`  export type ${listName}UpdateInput = { ${createMembers} }`)
    lines.push(`  export type ${listName}Select = { ${selectMembers} }`)
    lines.push(`  export type ${listName}Include = { ${includeMembers} }`)
    lines.push(`  export type ${listName}WhereInput = { id?: string }`)
    lines.push(
      `  export type ${listName}CreateArgs = { data: ${listName}CreateInput; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(
      `  export type ${listName}UpdateArgs = { where: { id: string }; data: ${listName}UpdateInput; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(
      `  export type ${listName}FindUniqueArgs = { where: { id: string }; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(
      `  export type ${listName}FindManyArgs = { where?: ${listName}WhereInput; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(
      `  export type ${listName}FindFirstArgs = { where?: ${listName}WhereInput; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(
      `  export type ${listName}DeleteArgs = { where: { id: string }; select?: ${listName}Select | null; include?: ${listName}Include | null }`,
    )
    lines.push(`  export type ${listName}CountArgs = { where?: ${listName}WhereInput }`)
    lines.push(`  export type ${listName}GetPayload<T> = { id: string }`)
    lines.push('')
  }

  lines.push('}')
  return lines.join('\n')
}

const CORE_STUB = `
export interface Session { [key: string]: unknown }
export interface AccessContext<P> {
  db: unknown
  session: Session
  prisma: P
  storage: unknown
  plugins: Record<string, unknown>
  _isSudo: boolean
}
`

const CORE_INTERNAL_STUB = `
export type StorageUtils = unknown
export type ServerActionProps = unknown
export type AccessControlledDB<P> = Record<string, unknown>
export type Fragment<A, B> = unknown
export type FieldSelection<A> = unknown
`

const PLUGIN_TYPES_STUB = `export type PluginServices = unknown\n`

const CONSUMER = `
import type { Context } from './types.ts'

declare const context: Context

async function run() {
  const model0 = await context.db.model0.findUnique({ where: { id: '1' }, include: { tenant: true, next: true } })
  const created = await context.db.model5.create({ data: { title: 't', code: 'c', tenant: { connect: { id: 't1' } } } })
  const sudoContext = context.sudo()
  const nested = await sudoContext.db.model10.findMany({ include: { previous: true, next: true } })
  void model0
  void created
  void nested
}

void run
`

function compileFixture(generatedTypes: string, prismaStub: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-large-schema-'))
  try {
    const prismaClientDir = path.join(dir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })
    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), prismaStub)
    fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(dir, 'consumer.ts'), CONSUMER)

    const coreDir = path.join(dir, '_stubs')
    fs.mkdirSync(coreDir, { recursive: true })
    fs.writeFileSync(path.join(coreDir, 'core.ts'), CORE_STUB)
    fs.writeFileSync(path.join(coreDir, 'core-internal.ts'), CORE_INTERNAL_STUB)
    fs.writeFileSync(path.join(dir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)
    fs.writeFileSync(
      path.join(coreDir, 'decimal.ts'),
      'export class Decimal { constructor(_v: string | number) {} }\n',
    )

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      paths: {
        '@opensaas/stack-core': [path.join(coreDir, 'core.ts')],
        '@opensaas/stack-core/internal': [path.join(coreDir, 'core-internal.ts')],
        'decimal.js': [path.join(coreDir, 'decimal.ts')],
      },
    }

    const rootNames = [
      path.join(dir, 'types.ts'),
      path.join(dir, 'consumer.ts'),
      path.join(prismaClientDir, 'client.ts'),
    ]
    const program = ts.createProgram({ rootNames, options: compilerOptions })
    return [...ts.getPreEmitDiagnostics(program)]
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('large-schema Context/CustomDB type-checks (#952)', () => {
  it(
    `type-checks a generated Context/CustomDB for ${LIST_COUNT + 1} lists without TS2589`,
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const config = buildLargeSchemaConfig()
      const generated = generateTypes(config)
      const prismaStub = buildPrismaStub(config)

      const diagnostics = compileFixture(generated, prismaStub)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      const depthErrors = messages.filter((m) => m.includes('excessively deep'))
      expect(depthErrors).toEqual([])
      expect(messages).toEqual([])
    },
  )
})
