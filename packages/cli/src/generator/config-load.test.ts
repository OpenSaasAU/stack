import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOpenSaasConfig } from './config-load.js'

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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-load-test-'))
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
    expect((first.config as { client: number }).client).toBe(1)

    fs.writeFileSync(modulePath, 'export const client = 2\n')

    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as { client: number }).client).toBe(2)
    expect(second.resolvedModules).toEqual([modulePath])
  })

  it('sees a config edit made between two loads — the pre-existing freshness guarantee still holds', async () => {
    fs.writeFileSync(configPath, 'export default { lists: {}, revision: 1 }\n')
    const first = await loadOpenSaasConfig(tempDir, configPath)
    expect((first.config as { revision: number }).revision).toBe(1)

    fs.writeFileSync(configPath, 'export default { lists: {}, revision: 2 }\n')
    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as { revision: number }).revision).toBe(2)
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
    expect((first.config as { value: number }).value).toBe(1)

    fs.writeFileSync(path.join(packageDir, 'index.ts'), 'export const value: number = 2\n')

    const second = await loadOpenSaasConfig(tempDir, configPath)
    expect((second.config as { value: number }).value).toBe(2)
    expect(second.resolvedModules).toEqual([])
  })
})
