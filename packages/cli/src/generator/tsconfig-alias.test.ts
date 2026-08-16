import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createJiti } from 'jiti'
import { resolveTsconfigAlias } from './tsconfig-alias.js'

describe('resolveTsconfigAlias', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-alias-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeTsconfig(content: unknown | string) {
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    )
  }

  it('returns no alias when there is no tsconfig.json', () => {
    expect(resolveTsconfigAlias(tempDir)).toEqual({ alias: undefined, warnings: [] })
  })

  it('returns no alias when tsconfig.json has no paths', () => {
    writeTsconfig({ compilerOptions: { strict: true } })
    expect(resolveTsconfigAlias(tempDir)).toEqual({ alias: undefined, warnings: [] })
  })

  it('translates a single-trailing-star alias against the default baseUrl (tsconfig dir)', () => {
    writeTsconfig({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(warnings).toEqual([])
    expect(alias).toEqual({ '@/': path.join(tempDir, 'src') })
  })

  it('resolves the alias target against an explicit baseUrl', () => {
    writeTsconfig({
      compilerOptions: { baseUrl: './app', paths: { '@/*': ['./*'] } },
    })

    const { alias } = resolveTsconfigAlias(tempDir)

    expect(alias).toEqual({ '@/': path.join(tempDir, 'app') })
  })

  it('handles multiple alias patterns in one tsconfig', () => {
    writeTsconfig({
      compilerOptions: {
        paths: {
          '@/*': ['./src/*'],
          '@utils/*': ['./src/utils/*'],
        },
      },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(warnings).toEqual([])
    expect(alias).toEqual({
      '@/': path.join(tempDir, 'src'),
      '@utils/': path.join(tempDir, 'src', 'utils'),
    })
  })

  it('warns and skips a paths entry with more than one candidate target', () => {
    writeTsconfig({
      compilerOptions: { paths: { '@/*': ['./src/*', './lib/*'] } },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('@/*')
    expect(warnings[0]).toContain('2 candidate target')
  })

  it('warns and skips a pattern with no wildcard', () => {
    writeTsconfig({
      compilerOptions: { paths: { config: ['./config.ts'] } },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('config')
  })

  it('warns and skips a pattern whose star is not the trailing character', () => {
    writeTsconfig({
      compilerOptions: { paths: { '@/*.css': ['./src/*.css'] } },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('warns and skips a bare "*" catch-all pattern instead of aliasing every specifier', () => {
    writeTsconfig({
      compilerOptions: { paths: { '*': ['./src/*'], '@utils/*': ['./src/utils/*'] } },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toEqual({ '@utils/': path.join(tempDir, 'src', 'utils') })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"*"')
    expect(warnings[0]).toContain('catch-all')
  })

  it('mixes representable and unrepresentable entries: resolves one, warns on the other', () => {
    writeTsconfig({
      compilerOptions: {
        paths: {
          '@/*': ['./src/*'],
          '@shared/*': ['./packages/a/*', './packages/b/*'],
        },
      },
    })

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toEqual({ '@/': path.join(tempDir, 'src') })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('@shared/*')
  })

  it('tolerates JSONC comments and trailing commas (common in tsconfig.json)', () => {
    writeTsconfig(`{
      // path aliases
      "compilerOptions": {
        "paths": {
          "@/*": ["./src/*"], /* trailing comma above, block comment here */
        },
      },
    }`)

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(warnings).toEqual([])
    expect(alias).toEqual({ '@/': path.join(tempDir, 'src') })
  })

  it('warns rather than throwing on unparseable JSON', () => {
    writeTsconfig('{ this is not json')

    const { alias, warnings } = resolveTsconfigAlias(tempDir)

    expect(alias).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('could not be parsed')
  })
})

describe('resolveTsconfigAlias + jiti integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-alias-jiti-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves a value import in the config through the alias', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    )
    fs.mkdirSync(path.join(tempDir, 'src', 'opensaas'), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, 'src', 'opensaas', 'lists.ts'),
      "export const lists = { hello: 'world' }\n",
    )
    fs.writeFileSync(
      path.join(tempDir, 'opensaas.config.ts'),
      "import { lists } from '@/opensaas/lists'\nexport default { lists }\n",
    )

    const { alias } = resolveTsconfigAlias(tempDir)
    const jiti = createJiti(tempDir, { interopDefault: true, alias })

    const mod = (await jiti.import(path.join(tempDir, 'opensaas.config.ts'))) as {
      default: { lists: { hello: string } }
    }
    expect(mod.default.lists).toEqual({ hello: 'world' })
  })

  it('resolves the alias transitively through the config’s own import closure', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    )
    fs.mkdirSync(path.join(tempDir, 'src', 'opensaas'), { recursive: true })
    // A module two hops deep also uses the alias — the config imports
    // `helpers.ts`, which itself imports `lists.ts` via the alias.
    fs.writeFileSync(
      path.join(tempDir, 'src', 'opensaas', 'lists.ts'),
      "export const lists = { hello: 'transitive' }\n",
    )
    fs.writeFileSync(
      path.join(tempDir, 'src', 'opensaas', 'helpers.ts'),
      "export { lists } from '@/opensaas/lists'\n",
    )
    fs.writeFileSync(
      path.join(tempDir, 'opensaas.config.ts'),
      "import { lists } from './src/opensaas/helpers'\nexport default { lists }\n",
    )

    const { alias } = resolveTsconfigAlias(tempDir)
    const jiti = createJiti(tempDir, { interopDefault: true, alias })

    const mod = (await jiti.import(path.join(tempDir, 'opensaas.config.ts'))) as {
      default: { lists: { hello: string } }
    }
    expect(mod.default.lists).toEqual({ hello: 'transitive' })
  })

  it('a bare "*" catch-all does not corrupt resolution of the config’s own absolute path (issue repro)', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '*': ['./src/*'] } } }),
    )
    fs.writeFileSync(path.join(tempDir, 'opensaas.config.ts'), 'export default { lists: {} }\n')

    const { alias } = resolveTsconfigAlias(tempDir)
    expect(alias).toBeUndefined()

    const jiti = createJiti(tempDir, { interopDefault: true, alias })
    const mod = (await jiti.import(path.join(tempDir, 'opensaas.config.ts'))) as {
      default: { lists: Record<string, never> }
    }
    expect(mod.default.lists).toEqual({})
  })

  it('fails to resolve the alias when no tsconfig.json is present (baseline without the fix)', async () => {
    fs.mkdirSync(path.join(tempDir, 'src', 'opensaas'), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, 'src', 'opensaas', 'lists.ts'),
      "export const lists = { hello: 'world' }\n",
    )
    fs.writeFileSync(
      path.join(tempDir, 'opensaas.config.ts'),
      "import { lists } from '@/opensaas/lists'\nexport default { lists }\n",
    )

    const { alias } = resolveTsconfigAlias(tempDir)
    expect(alias).toBeUndefined()

    const jiti = createJiti(tempDir, { interopDefault: true, alias })
    await expect(jiti.import(path.join(tempDir, 'opensaas.config.ts'))).rejects.toThrow()
  })
})
