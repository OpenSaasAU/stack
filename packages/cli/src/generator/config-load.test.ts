import * as fs from 'fs'
import { createRequire } from 'module'
import * as os from 'os'
import * as path from 'path'
import { createJiti } from 'jiti'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOpenSaasConfig, loadProjectEnvFile } from './config-load.js'

/**
 * `loadOpenSaasConfig` through real jiti, never mocked: the module graph it
 * reports (#1414) is read off jiti's own module cache, and the dev loop's
 * freshness guarantee — a second load of the same path must see the file's
 * current bytes, not a stale copy — depends on internals no mock would catch
 * a regression in.
 */
describe('loadOpenSaasConfig', () => {
  let tempDir: string
  let configPath: string

  beforeEach(() => {
    // realpath'd: jiti reports the resolved module graph canonicalized, and on
    // macOS os.tmpdir() is under a symlink (/var -> /private/var) — comparing
    // against the un-resolved path would fail on every mac, never on CI's Linux.
    tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'config-load-test-'))
    configPath = path.join(tempDir, 'opensaas.config.ts')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('reports no resolved modules for a config with no imports of its own', async () => {
    fs.writeFileSync(configPath, 'export default { lists: {} }\n')

    const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

    expect(resolvedModules).toEqual([])
  })

  it('resolves a project-local module the config imports directly', async () => {
    const modulePath = path.join(tempDir, 'db-client.ts')
    fs.writeFileSync(modulePath, 'export const client = 1\n')
    fs.writeFileSync(
      configPath,
      "import { client } from './db-client.js'\nexport default { lists: {}, client }\n",
    )

    const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

    expect(resolvedModules).toEqual([modulePath])
  })

  it('resolves a module two hops deep — the transitive import closure, not just the direct one', async () => {
    const leafPath = path.join(tempDir, 'leaf.ts')
    const middlePath = path.join(tempDir, 'middle.ts')
    fs.writeFileSync(leafPath, 'export const value = 1\n')
    fs.writeFileSync(middlePath, "export { value } from './leaf.js'\n")
    fs.writeFileSync(
      configPath,
      "import { value } from './middle.js'\nexport default { lists: {}, value }\n",
    )

    const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

    expect(resolvedModules.sort()).toEqual([leafPath, middlePath].sort())
  })

  it('never reports the config file itself as one of the modules it imported', async () => {
    const modulePath = path.join(tempDir, 'db-client.ts')
    fs.writeFileSync(modulePath, 'export const client = 1\n')
    fs.writeFileSync(
      configPath,
      "import { client } from './db-client.js'\nexport default { lists: {}, client }\n",
    )

    const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

    expect(resolvedModules).not.toContain(configPath)
  })

  it('excludes a dependency resolved into node_modules — only the config’s own modules are reported', async () => {
    const packageDir = path.join(tempDir, 'node_modules', 'a-dependency')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'a-dependency', main: 'index.js', type: 'module' }),
    )
    fs.writeFileSync(path.join(packageDir, 'index.js'), 'export const value = 1\n')

    const modulePath = path.join(tempDir, 'db-client.ts')
    fs.writeFileSync(
      modulePath,
      "import { value } from 'a-dependency'\nexport const client = value\n",
    )
    fs.writeFileSync(
      configPath,
      "import { client } from './db-client.js'\nexport default { lists: {}, client }\n",
    )

    const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

    expect(resolvedModules).toEqual([modulePath])
  })

  it('sees a module edit made between two loads — the module cache used to read the graph never leaks stale bytes', async () => {
    const modulePath = path.join(tempDir, 'db-client.ts')
    fs.writeFileSync(modulePath, 'export const client = 1\n')
    fs.writeFileSync(
      configPath,
      "import { client } from './db-client.js'\nexport default { lists: {}, client }\n",
    )

    const first = await loadOpenSaasConfig(tempDir, configPath)
    expect((first.config as unknown as { client: number }).client).toBe(1)

    fs.writeFileSync(modulePath, 'export const client = 2\n')

    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as unknown as { client: number }).client).toBe(2)
    expect(second.resolvedModules).toEqual([modulePath])
  })

  it('sees a config edit made between two loads — the pre-existing freshness guarantee still holds', async () => {
    fs.writeFileSync(configPath, 'export default { lists: {}, revision: 1 }\n')
    const first = await loadOpenSaasConfig(tempDir, configPath)
    expect((first.config as unknown as { revision: number }).revision).toBe(1)

    fs.writeFileSync(configPath, 'export default { lists: {}, revision: 2 }\n')
    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as unknown as { revision: number }).revision).toBe(2)
  })

  it('sees an edit to a node_modules dependency still on raw TypeScript form between two loads — excluded from the watch list is not exempt from the freshness guarantee', async () => {
    // Stands in for a workspace-linked package or a git dependency with no
    // prebuilt dist: jiti has to run its own transform to load it, exactly as
    // it does for a project file, so it ends up in the same cache — and this
    // load's own bytes must still win over what a previous load cached, same
    // as for a project file.
    const packageDir = path.join(tempDir, 'node_modules', 'a-dependency')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'a-dependency', main: 'index.ts', type: 'module' }),
    )
    fs.writeFileSync(path.join(packageDir, 'index.ts'), 'export const value: number = 1\n')
    fs.writeFileSync(
      configPath,
      "import { value } from 'a-dependency'\nexport default { lists: {}, value }\n",
    )

    const first = await loadOpenSaasConfig(tempDir, configPath)
    expect((first.config as unknown as { value: number }).value).toBe(1)

    fs.writeFileSync(path.join(packageDir, 'index.ts'), 'export const value: number = 2\n')

    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as unknown as { value: number }).value).toBe(2)
    expect(second.resolvedModules).toEqual([])
  })

  describe('after a load that failed (#2169)', () => {
    const revisionIn = (config: object): number => {
      if ('revision' in config && typeof config.revision === 'number') return config.revision
      throw new Error('The config carries no numeric revision.')
    }

    const revisionOf = async (): Promise<number> => {
      const { config } = await loadOpenSaasConfig(tempDir, configPath)
      return revisionIn(config)
    }

    const writeRevision = (revision: number): void => {
      fs.writeFileSync(configPath, `export default { lists: {}, revision: ${revision} }\n`)
    }

    it.each([
      ['a parse error', 'export default {{{\n'],
      ['a runtime throw', "throw new Error('boom')\n"],
      ['a rejected default export', "export default Promise.reject(new Error('boom'))\n"],
    ])('sees fresh bytes on every load after %s in the config', async (_, broken) => {
      writeRevision(1)
      expect(await revisionOf()).toBe(1)

      fs.writeFileSync(configPath, broken)
      await expect(loadOpenSaasConfig(tempDir, configPath)).rejects.toThrow()

      writeRevision(2)
      expect(await revisionOf()).toBe(2)
      writeRevision(3)
      expect(await revisionOf()).toBe(3)
      writeRevision(4)
      expect(await revisionOf()).toBe(4)
    })

    it.each([
      ['a parse error', 'export const revision = {{{\n'],
      ['a runtime throw', "throw new Error('boom')\n"],
    ])(
      'sees fresh bytes in the failing module and its importers after %s two hops down',
      async (_, broken) => {
        const leafPath = path.join(tempDir, 'leaf.ts')
        const middlePath = path.join(tempDir, 'middle.ts')
        const writeLeaf = (revision: number): void => {
          fs.writeFileSync(leafPath, `export const revision = ${revision}\n`)
        }
        const writeMiddle = (offset: number): void => {
          fs.writeFileSync(
            middlePath,
            `import { revision as leaf } from './leaf.js'\nexport const revision = leaf + ${offset}\n`,
          )
        }
        writeLeaf(1)
        writeMiddle(0)
        fs.writeFileSync(
          configPath,
          "import { revision } from './middle.js'\nexport default { lists: {}, revision }\n",
        )
        expect(await revisionOf()).toBe(1)

        fs.writeFileSync(leafPath, broken)
        await expect(loadOpenSaasConfig(tempDir, configPath)).rejects.toThrow()

        writeLeaf(2)
        expect(await revisionOf()).toBe(2)
        writeLeaf(3)
        expect(await revisionOf()).toBe(3)
        writeMiddle(10)
        expect(await revisionOf()).toBe(13)
        writeMiddle(20)
        expect(await revisionOf()).toBe(23)
      },
    )

    it.each([
      ['a sibling workspace directory', ['..', 'shared', 'leaf.ts'], '../shared/leaf.js'],
      ['a source-form dependency', ['node_modules', 'a-dependency', 'index.ts'], 'a-dependency'],
    ])('sees fresh bytes in a failing module in %s', async (_, segments, specifier) => {
      const projectDir = path.join(tempDir, 'app')
      const projectConfig = path.join(projectDir, 'opensaas.config.ts')
      const leafPath = path.join(projectDir, ...segments)
      fs.mkdirSync(projectDir, { recursive: true })
      fs.mkdirSync(path.dirname(leafPath), { recursive: true })
      if (specifier === 'a-dependency') {
        fs.writeFileSync(
          path.join(path.dirname(leafPath), 'package.json'),
          JSON.stringify({ name: 'a-dependency', main: 'index.ts', type: 'module' }),
        )
      }
      fs.writeFileSync(
        projectConfig,
        `import { revision } from '${specifier}'\nexport default { lists: {}, revision }\n`,
      )
      const loadRevision = async (): Promise<number> => {
        const { config } = await loadOpenSaasConfig(projectDir, projectConfig)
        return revisionIn(config)
      }

      fs.writeFileSync(leafPath, "throw new Error('boom')\n")
      await expect(loadOpenSaasConfig(projectDir, projectConfig)).rejects.toThrow('boom')

      fs.writeFileSync(leafPath, 'export const revision = 2\n')
      expect(await loadRevision()).toBe(2)
      fs.writeFileSync(leafPath, 'export const revision = 3\n')
      expect(await loadRevision()).toBe(3)
    })

    it('tracks a module the config only imports while its default export resolves', async () => {
      const latePath = path.join(tempDir, 'late.ts')
      fs.writeFileSync(latePath, 'export const revision = 1\n')
      fs.writeFileSync(
        configPath,
        "const settled = new Promise((resolve) => setTimeout(resolve, 10))\nexport default settled.then(() => import('./late.js')).then(({ revision }) => ({ lists: {}, revision }))\n",
      )

      const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)

      expect(resolvedModules).toEqual([latePath])
    })

    it('reports the module graph after recovering, not an empty one', async () => {
      const modulePath = path.join(tempDir, 'db-client.ts')
      fs.writeFileSync(modulePath, "throw new Error('boom')\n")
      fs.writeFileSync(
        configPath,
        "import { client } from './db-client.js'\nexport default { lists: {}, client }\n",
      )
      await expect(loadOpenSaasConfig(tempDir, configPath)).rejects.toThrow('boom')

      fs.writeFileSync(modulePath, 'export const client = 1\n')

      const { resolvedModules } = await loadOpenSaasConfig(tempDir, configPath)
      expect(resolvedModules).toEqual([modulePath])
    })

    it('reloads a config another jiti left in the process-wide cache', async () => {
      writeRevision(1)
      const other = createJiti(tempDir, { moduleCache: true })
      await other.import(configPath)
      expect(Object.keys(other.cache)).toContain(configPath)

      writeRevision(2)
      expect(await revisionOf()).toBe(2)
      expect(Object.keys(other.cache)).not.toContain(configPath)
    })

    it('leaves entries it does not own in the process-wide cache, on success and failure', async () => {
      const elsewhere = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'config-load-other-'),
      )
      const foreignPath = path.join(elsewhere, 'foreign.cjs')
      const dependencyPath = path.join(tempDir, 'node_modules', 'a-dependency', 'index.cjs')
      const hostPath = path.join(tempDir, 'packages', 'host', 'dist', 'index.cjs')
      fs.writeFileSync(foreignPath, 'module.exports = 1\n')
      for (const file of [dependencyPath, hostPath]) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, 'module.exports = 1\n')
      }

      const nodeRequire = createRequire(import.meta.url)
      nodeRequire(foreignPath)
      nodeRequire(dependencyPath)
      nodeRequire(hostPath)

      try {
        writeRevision(1)
        await loadOpenSaasConfig(tempDir, configPath)
        fs.writeFileSync(configPath, "throw new Error('boom')\n")
        await expect(loadOpenSaasConfig(tempDir, configPath)).rejects.toThrow('boom')

        expect(Object.keys(nodeRequire.cache)).toEqual(
          expect.arrayContaining([foreignPath, dependencyPath, hostPath]),
        )
      } finally {
        delete nodeRequire.cache[foreignPath]
        delete nodeRequire.cache[dependencyPath]
        delete nodeRequire.cache[hostPath]
        fs.rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })
})

describe('loadProjectEnvFile', () => {
  let tempDir: string
  let originalValue: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-test-'))
    originalValue = process.env.LOAD_PROJECT_ENV_FILE_TEST
    delete process.env.LOAD_PROJECT_ENV_FILE_TEST
  })

  afterEach(() => {
    if (originalValue === undefined) delete process.env.LOAD_PROJECT_ENV_FILE_TEST
    else process.env.LOAD_PROJECT_ENV_FILE_TEST = originalValue
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads a variable from the project .env into process.env', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), 'LOAD_PROJECT_ENV_FILE_TEST=from-dotenv\n')

    loadProjectEnvFile(tempDir)

    expect(process.env.LOAD_PROJECT_ENV_FILE_TEST).toBe('from-dotenv')
  })

  it('leaves a variable already in the environment untouched — a shell value wins', () => {
    process.env.LOAD_PROJECT_ENV_FILE_TEST = 'from-shell'
    fs.writeFileSync(path.join(tempDir, '.env'), 'LOAD_PROJECT_ENV_FILE_TEST=from-dotenv\n')

    loadProjectEnvFile(tempDir)

    expect(process.env.LOAD_PROJECT_ENV_FILE_TEST).toBe('from-shell')
  })

  it.each(['.env.local', '.env.development', '.env.development.local'])(
    'loads %s and reports it as the source',
    (name) => {
      fs.writeFileSync(path.join(tempDir, name), 'LOAD_PROJECT_ENV_FILE_TEST=from-file\n')

      const sources = loadProjectEnvFile(tempDir)

      expect(process.env.LOAD_PROJECT_ENV_FILE_TEST).toBe('from-file')
      expect(sources.get('LOAD_PROJECT_ENV_FILE_TEST')).toBe(name)
    },
  )

  it('applies Next precedence between files', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), 'LOAD_PROJECT_ENV_FILE_TEST=base\n')
    fs.writeFileSync(path.join(tempDir, '.env.local'), 'LOAD_PROJECT_ENV_FILE_TEST=local\n')

    loadProjectEnvFile(tempDir)

    expect(process.env.LOAD_PROJECT_ENV_FILE_TEST).toBe('local')
  })

  it('does nothing when the project has no .env', () => {
    expect(() => loadProjectEnvFile(tempDir)).not.toThrow()
    expect(process.env.LOAD_PROJECT_ENV_FILE_TEST).toBeUndefined()
  })
})
