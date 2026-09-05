import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
