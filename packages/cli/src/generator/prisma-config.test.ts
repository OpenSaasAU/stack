import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { ContractData } from '@opensaas/stack-core'
import { generatePrismaConfig, writePrismaConfig } from './prisma-config.js'

function contract(extensions: ContractData['extensions'] = []): ContractData {
  return { models: [], namespaces: [], enums: [], extensions }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-prisma-config-'))
  tempDirs.push(dir)
  return dir
}

describe('generatePrismaConfig', () => {
  it('wraps the ORM options in the CLI version marker', () => {
    const output = generatePrismaConfig(contract(), './prisma/contract.ts', './prisma')

    expect(output).toContain("import { definePrismaConfig } from 'prisma/config'")
    expect(output).toContain("import { defineConfig } from '@prisma/orm-postgres/config'")
    expect(output).toContain('export default definePrismaConfig({')
    expect(output).toContain('  orm: defineConfig({')
  })

  it('points the contract and output at the resolved locations', () => {
    const output = generatePrismaConfig(contract(), './db/contract.ts', './db')

    expect(output).toContain("contract: './db/contract.ts',")
    expect(output).toContain("output: './db',")
  })

  it('resolves the connection through the stack URL lookup, never process.env', () => {
    const output = generatePrismaConfig(contract(), './prisma/contract.ts', './prisma')

    expect(output).toContain("import { findDatabaseUrl } from '@opensaas/stack-core'")
    expect(output).toContain('db: { connection: findDatabaseUrl() },')
    expect(output).not.toContain('process.env')
  })

  it('loads the project .env before it resolves the connection', () => {
    const lines = generatePrismaConfig(contract(), './prisma/contract.ts', './prisma').split('\n')

    const load = lines.findIndex((line) => line.includes('process.loadEnvFile(envFile)'))
    const connection = lines.findIndex((line) => line.includes('findDatabaseUrl()'))

    expect(load).toBeGreaterThan(-1)
    expect(load).toBeLessThan(connection)
    expect(lines).toContain("const envFile = join(import.meta.dirname, '.env')")
    // `loadEnvFile` throws on a missing file, so the guard is load-bearing.
    expect(lines).toContain('if (existsSync(envFile)) process.loadEnvFile(envFile)')
  })

  it('never imports the app config', () => {
    const output = generatePrismaConfig(contract(), './prisma/contract.ts', './prisma')
    const imports = output.split('\n').filter((line) => line.startsWith('import '))
    expect(imports.some((line) => line.includes('opensaas.config'))).toBe(false)
    // Nothing relative either: the file must stand alone from the app's tree.
    expect(imports.some((line) => /from '\.\.?\//.test(line))).toBe(false)
  })

  it('imports each declared pack control façade and lists it in extensions', () => {
    const output = generatePrismaConfig(
      contract([
        { name: 'pgvector', from: '@prisma/orm-extension-pgvector' },
        { name: 'postgis', from: '@prisma/orm-extension-postgis' },
      ]),
      './prisma/contract.ts',
      './prisma',
    )

    expect(output).toContain("import pgvector from '@prisma/orm-extension-pgvector/control'")
    expect(output).toContain("import postgis from '@prisma/orm-extension-postgis/control'")
    expect(output).toContain('extensions: [pgvector, postgis],')
    // The `/pack` flavour belongs to the Contract module, not here.
    expect(output).not.toContain("/pack'")
  })

  it('emits an empty extensions list when the config declares no packs', () => {
    expect(generatePrismaConfig(contract(), './prisma/contract.ts', './prisma')).toContain(
      'extensions: [],',
    )
  })

  it('matches the full snapshot', () => {
    expect(
      generatePrismaConfig(
        contract([{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }]),
        './prisma/contract.ts',
        './prisma',
      ),
    ).toMatchSnapshot()
  })
})

describe('writePrismaConfig', () => {
  it('writes the file, creating the directory when needed', () => {
    const dir = tempDir()
    const target = path.join(dir, 'nested', 'prisma.config.ts')

    writePrismaConfig(contract(), target, {
      contractModule: './prisma/contract.ts',
      outputDir: './prisma',
    })

    expect(fs.readFileSync(target, 'utf-8')).toContain('definePrismaConfig')
  })

  it('overwrites a pre-existing file rather than merging into it', () => {
    const dir = tempDir()
    const target = path.join(dir, 'prisma.config.ts')
    fs.writeFileSync(target, '// hand-edited\n')

    writePrismaConfig(contract(), target, {
      contractModule: './prisma/contract.ts',
      outputDir: './prisma',
    })

    expect(fs.readFileSync(target, 'utf-8')).not.toContain('hand-edited')
  })
})

/**
 * The emitted file has to run, not just read correctly: it is evaluated for
 * every Prisma command, so a `.env` that never loads leaves `db update` and
 * `migrate` with no connection, and an unguarded `loadEnvFile` breaks every
 * command for a project that keeps none.
 *
 * The scratch project lives inside this package so node resolution reaches its
 * `node_modules` for `jiti`, `prisma`, `@prisma/orm-postgres` and
 * `@opensaas/stack-core`, and the child process runs without the connection
 * variables CI exports.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const EVALUATE = `
const { createJiti } = await import('jiti')
const jiti = createJiti(process.cwd(), { interopDefault: true })
await jiti.import(process.cwd() + '/prisma.config.ts')
const { findDatabaseUrl } = await import('@opensaas/stack-core')
process.stdout.write(JSON.stringify({ connection: findDatabaseUrl() ?? null }))
`

function evaluateGeneratedConfig(dotenv?: string): { connection: string | null } {
  const projectDir = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-prisma-config-'))
  tempDirs.push(projectDir)

  writePrismaConfig(contract(), path.join(projectDir, 'prisma.config.ts'), {
    contractModule: './prisma/contract.ts',
    outputDir: './prisma',
  })
  if (dotenv !== undefined) {
    fs.writeFileSync(path.join(projectDir, '.env'), dotenv, 'utf-8')
  }

  const env = { ...process.env }
  delete env.DATABASE_URL
  delete env.DIRECT_DATABASE_URL

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', EVALUATE], {
    cwd: projectDir,
    env,
    encoding: 'utf-8',
  })

  expect(`${result.stderr ?? ''}`.trim()).toBe('')
  expect(result.status).toBe(0)

  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== 'object' || parsed === null || !('connection' in parsed)) {
    throw new Error(`Unexpected evaluation output: ${result.stdout}`)
  }
  const { connection } = parsed
  if (connection !== null && typeof connection !== 'string') {
    throw new Error(`Unexpected connection value: ${result.stdout}`)
  }
  return { connection }
}

describe('the emitted prisma.config.ts evaluates', () => {
  it('resolves the connection a .env carries', () => {
    expect(evaluateGeneratedConfig('DATABASE_URL=postgres://dotenv/db\n')).toEqual({
      connection: 'postgres://dotenv/db',
    })
  }, 60_000)

  it('evaluates with no .env present, leaving the connection unresolved', () => {
    expect(evaluateGeneratedConfig()).toEqual({ connection: null })
  }, 60_000)

  it('prefers the direct connection over the pooled one (ADR-0003)', () => {
    expect(
      evaluateGeneratedConfig(
        'DATABASE_URL=postgres://pooler/db\nDIRECT_DATABASE_URL=postgres://direct/db\n',
      ),
    ).toEqual({ connection: 'postgres://direct/db' })
  }, 60_000)
})
