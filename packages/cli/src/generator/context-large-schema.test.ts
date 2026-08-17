import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateContext } from './context.js'
import { generateTypes } from './types.js'
import type { OpenSaasConfig, ListConfig } from '@opensaas/stack-core'
import { text, integer, checkbox, json, relationship } from '@opensaas/stack-core/fields'

/**
 * Regression test for #958: deleting the generated `prisma-extensions.ts`
 * module and its unreachable `$extends` branch in `context.ts` must resolve
 * #956's `TS2589: Type instantiation is excessively deep and possibly
 * infinite`, which #956 root-caused to the removed branch's inferred return
 * type (`PrismaClient | ReturnType<typeof basePrisma.$extends>`), not to
 * `CustomDB`/`Context`/`GetPayload` (already covered by #952's regression
 * test in types-large-schema.test.ts, which does not exercise `context.ts`).
 *
 * Must run under this package's `typescript` dependency (aliased to the TS 6
 * compatibility shim, `@typescript/typescript6`) — TS 7's native binary does
 * not reproduce #956, so compiling with it would prove nothing here.
 */

const COMPILE_TIMEOUT_MS = 120_000
const LIST_COUNT = 25

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
    db: {
      provider: 'postgresql',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaClientConstructor: ((PrismaClientClass: any) => new PrismaClientClass()) as any,
    },
    lists,
  }
}

/** Flat (non-conditional) Prisma stub, mirroring types-large-schema.test.ts. */
function buildPrismaStub(config: OpenSaasConfig): string {
  const lines: string[] = [
    "import type { Decimal } from 'decimal.js'",
    '',
    'export class PrismaClient {',
    '  constructor(..._args: unknown[]) {}',
    '}',
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

/**
 * `@opensaas/stack-core` root-entry stub. Adds `getContext` and
 * `OpenSaasConfig` (both consumed by `context.ts`) on top of the
 * `Session`/`AccessContext` shape types-large-schema.test.ts already stubs
 * for `types.ts`. `OpenSaasConfig.db` is typed loosely but keeps
 * `prismaClientConstructor` so `context.ts`'s custom-constructor branch
 * type-checks against a realistic shape rather than `any`.
 */
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
export type OpenSaasConfig = {
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaClientConstructor?: (PrismaClientClass: any) => any
    [key: string]: unknown
  }
  [key: string]: unknown
}
export function getContext(...args: unknown[]): unknown {
  return undefined
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

/**
 * Compile the real generated `context.ts` + `types.ts` (with a stubbed
 * `prisma-client/` and project `opensaas.config.ts`) laid out exactly like
 * the real `.opensaas/` bundle, so `context.ts`'s `'../opensaas.config.ts'`
 * import resolves the same way it does in a generated project.
 */
function compileFixture(config: OpenSaasConfig, generatedContext: string, generatedTypes: string) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-context-large-schema-'))
  try {
    const opensaasDir = path.join(projectRoot, '.opensaas')
    const prismaClientDir = path.join(opensaasDir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })

    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), buildPrismaStub(config))
    fs.writeFileSync(path.join(opensaasDir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(opensaasDir, 'context.ts'), generatedContext)
    fs.writeFileSync(path.join(opensaasDir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)
    fs.writeFileSync(
      path.join(projectRoot, 'opensaas.config.ts'),
      [
        'export default {',
        "  db: { provider: 'postgresql', prismaClientConstructor: (PrismaClientClass: any) => new PrismaClientClass() },",
        '}',
      ].join('\n') + '\n',
    )

    const coreDir = path.join(projectRoot, '_stubs')
    fs.mkdirSync(coreDir, { recursive: true })
    fs.writeFileSync(path.join(coreDir, 'core.ts'), CORE_STUB)
    fs.writeFileSync(path.join(coreDir, 'core-internal.ts'), CORE_INTERNAL_STUB)
    fs.writeFileSync(
      path.join(coreDir, 'decimal.ts'),
      'export class Decimal { constructor(_v: string | number) {} }\n',
    )
    // context.ts reads `process.env.NODE_ENV`; a minimal ambient declaration
    // stands in for @types/node so the fixture doesn't need it on the path.
    const globalsPath = path.join(coreDir, 'globals.d.ts')
    fs.writeFileSync(
      globalsPath,
      'declare const process: { env: Record<string, string | undefined> }\n',
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
      path.join(opensaasDir, 'context.ts'),
      path.join(opensaasDir, 'types.ts'),
      path.join(prismaClientDir, 'client.ts'),
      globalsPath,
    ]
    const program = ts.createProgram({ rootNames, options: compilerOptions })
    return [...ts.getPreEmitDiagnostics(program)]
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
}

describe('generated context.ts type-checks without TS2589 (#956 / #958)', () => {
  it(
    `type-checks the generated context factory for ${LIST_COUNT + 1} lists without excessive-depth errors`,
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const config = buildLargeSchemaConfig()
      const generatedContext = generateContext(config)
      const generatedTypes = generateTypes(config)

      // The dead `$extends` branch is gone: no import of the deleted module,
      // no reference to the function whose inferred return type caused #956.
      expect(generatedContext).not.toContain('prisma-extensions')
      expect(generatedContext).not.toContain('createExtendedPrisma')
      expect(generatedContext).not.toContain('$extends')

      const diagnostics = compileFixture(config, generatedContext, generatedTypes)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      const depthErrors = messages.filter(
        (m) => m.includes('excessively deep') || m.includes('Excessive stack depth'),
      )
      expect(depthErrors).toEqual([])
      expect(messages).toEqual([])
    },
  )
})
