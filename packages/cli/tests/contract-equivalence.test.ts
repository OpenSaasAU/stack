import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, test } from 'vitest'
import { createJiti } from 'jiti'
import pgvector from '@prisma/orm-extension-pgvector/pack'
import {
  buildPrismaContract,
  deriveContract,
  toEmittedContract,
  type PrismaContract,
  type PrismaContractPacks,
} from '../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import {
  authConfig,
  blogConfig,
  multiSchemaConfig,
  nativeTypesConfig,
  oneToOneConfig,
  ragConfig,
} from '../../core/tests/fixtures/contract-configs.js'
import { renderContractModule } from '../src/generator/contract-module.js'

// The rendered module imports `@prisma/orm-postgres/*` and each pack by
// package name, so it has to be evaluated from a directory whose node
// resolution reaches this package's `node_modules`.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-'))
const tscBinary = path.join(packageRoot, 'node_modules', '.bin', 'tsc')

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

async function evaluateRendered(name: string, source: string): Promise<PrismaContract> {
  const dir = path.join(scratchRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'contract.ts')
  fs.writeFileSync(file, source, 'utf-8')
  const jiti = createJiti(dir, { interopDefault: true })
  const module = await jiti.import<{ contract: PrismaContract }>(file)
  return module.contract
}

const fixtures: { name: string; config: OpenSaasConfig; packs?: PrismaContractPacks }[] = [
  { name: 'blog', config: blogConfig },
  { name: 'auth', config: authConfig },
  { name: 'rag', config: ragConfig, packs: { pgvector } },
  { name: 'one-to-one', config: oneToOneConfig },
  { name: 'multi-schema', config: multiSchemaConfig },
  { name: 'native-types', config: nativeTypesConfig },
]

describe('renderContractModule — the rendered module and the in-process derivation agree', () => {
  for (const { name, config, packs } of fixtures) {
    test(`${name}: identical contract JSON`, async () => {
      const data = deriveContract(config)
      const source = renderContractModule(data)

      const inProcess = toEmittedContract(buildPrismaContract(data, { packs }))
      const rendered = toEmittedContract(await evaluateRendered(name, source))

      expect(rendered).toEqual(inProcess)
    })
  }
})

describe('renderContractModule — the module is standalone and literal', () => {
  test('imports only the contract builder, the column types and declared packs', () => {
    const source = renderContractModule(deriveContract(ragConfig))
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .map((line) => line.slice(line.lastIndexOf("'", line.length - 2) + 1, -1))

    expect([...new Set(imports)]).toEqual([
      '@prisma/orm-postgres/contract-builder',
      '@prisma/orm-extension-pgvector/pack',
    ])
  })

  test('reads no environment variable and imports no config', () => {
    for (const { config } of fixtures) {
      const source = renderContractModule(deriveContract(config))
      expect(source).not.toContain('process.env')
      // Every import is a bare package specifier: nothing relative, so
      // nothing from the app's own tree can reach the module.
      expect(source).not.toMatch(/from '\.\.?\//)
      for (const line of source.split('\n')) {
        if (line.startsWith('import ')) expect(line).toMatch(/from '@prisma\//)
      }
    }
  })

  test('re-emits a pack import from the descriptor rather than serialising a value', () => {
    const source = renderContractModule(deriveContract(ragConfig))
    expect(source).toContain("import pgvector from '@prisma/orm-extension-pgvector/pack'")
    expect(source).toContain('extensions: { pgvector }')
  })

  test('declares only the namespaces beyond public', () => {
    expect(renderContractModule(deriveContract(multiSchemaConfig))).toContain(
      "namespaces: ['auth']",
    )
    expect(renderContractModule(deriveContract(blogConfig))).not.toContain('namespaces:')
  })
})

describe('renderContractModule — the lowering table', () => {
  const blog = renderContractModule(deriveContract(blogConfig))

  test('id strategies', () => {
    expect(blog).toContain('id: field.id.uuidv7Native()')
    expect(blog).toContain('id: field.int().default(1).id()')
    expect(renderContractModule(deriveContract(oneToOneConfig))).toContain('id: field.id.cuid2()')
  })

  test('auto-timestamps use the string temporal presets', () => {
    expect(blog).toContain('createdAt: field.temporal.createdAtString()')
    expect(blog).toContain('updatedAt: field.temporal.updatedAtString()')
  })

  test('a named non-unique index goes through map, a unique through name', () => {
    expect(blog).toContain("{ map: 'post_author_status' }")
    const auth = renderContractModule(deriveContract(authConfig))
    expect(auth).toMatch(/constraints\.unique\(\[[^\]]*\], \{ name: '[^']+' \}\)/)
  })

  test('a foreign key is its own constraint, not a side effect of belongsTo', () => {
    expect(blog).toContain('constraints.foreignKey(')
    expect(blog).toContain("onDelete: 'setNull'")
    expect(blog).toContain("rel.belongsTo(() => models.User, { from: 'authorId', to: 'id' })")
  })

  test('relations use the thunk target form so forward references resolve', () => {
    expect(blog).toContain('rel.hasMany(() => models.Post,')
    const oneToOne = renderContractModule(deriveContract(oneToOneConfig))
    expect(oneToOne).toContain('rel.hasOne(')
  })

  test('an extension column is a pack-qualified type constructor', () => {
    expect(renderContractModule(deriveContract(ragConfig))).toContain(
      'field.column(type.pgvector.Vector(3))',
    )
  })
})

describe('renderContractModule — the rendered module is valid TypeScript for the CLI to emit', () => {
  test('every fixture renders a module whose evaluation succeeds', async () => {
    // A syntax error, an unbound identifier or a mis-ordered declaration would
    // fail here rather than at `prisma contract emit` in a user's project.
    for (const { name, config } of fixtures) {
      const contract = await evaluateRendered(
        `${name}-syntax`,
        renderContractModule(deriveContract(config)),
      )
      expect(contract).toBeDefined()
    }
  })

  test('the scratch evaluation directory is outside the OS temp root by design', () => {
    // Resolution has to reach this package's node_modules, which a directory
    // under os.tmpdir() cannot do.
    expect(scratchRoot.startsWith(os.tmpdir())).toBe(false)
  })

  test('every fixture type-checks under erasableSyntaxOnly and verbatimModuleSyntax', () => {
    // ADR-0054: the emitted bundle loads natively under Node, so nothing the
    // generator writes may need a transform beyond stripping types.
    const dir = path.join(scratchRoot, 'typecheck')
    fs.mkdirSync(dir, { recursive: true })
    for (const { name, config } of fixtures) {
      fs.writeFileSync(
        path.join(dir, `${name}.ts`),
        renderContractModule(deriveContract(config)),
        'utf-8',
      )
    }
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          erasableSyntaxOnly: true,
          verbatimModuleSyntax: true,
          types: [],
        },
        include: ['*.ts'],
      }),
      'utf-8',
    )

    const result = spawnSync(tscBinary, ['--project', dir], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()).toBe('')
    expect(result.status).toBe(0)
  }, 120_000)
})
