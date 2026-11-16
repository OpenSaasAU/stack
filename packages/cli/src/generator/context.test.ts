import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, it, expect } from 'vitest'
import type { ContractData, OpenSaasConfig } from '@opensaas/stack-core'
import { deriveContract } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { generateContext, projectDependsOnNext } from './context.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: { User: { fields: { name: text() } } },
}

const data: ContractData = deriveContract(config)

describe('generateContext', () => {
  it('quotes an extension specifier so it cannot break out of the import', () => {
    const hostile: ContractData = {
      ...data,
      extensions: [{ name: 'pgvector', from: "pack/x'\nglobalThis.PWNED = true\n//" }],
    }

    const context = generateContext(config, hostile)

    expect(context).toContain("from 'pack/x\\'\\nglobalThis.PWNED = true\\n///runtime'")
    expect(context).not.toMatch(/^globalThis\.PWNED/m)
  })

  it('constructs the client from the committed contract artifact', () => {
    const context = generateContext(config, data)

    expect(context).toContain("import postgres from '@prisma/orm-postgres/runtime'")
    expect(context).toContain(
      "import contractJson from '../prisma/contract.json' with { type: 'json' }",
    )
    // `.d.js`, not `.d.ts`: the Contract module sits in the same directory and
    // `./contract.d.ts` resolves to IT, not to the emitted declarations.
    expect(context).toContain("import type { Contract } from '../prisma/contract.d.js'")
    expect(context).toContain("import { contractFromJson } from '@prisma/orm-postgres/static'")
    expect(context).toContain('contract: contractFromJson<Contract>(contractJson),')
  })

  it('imports no generated Prisma client tree', () => {
    const context = generateContext(config, data)

    expect(context).not.toContain('prisma-client')
    expect(context).not.toContain('PrismaClient')
    expect(context).not.toContain('prismaClientConstructor')
  })

  it('delegates the connection to core, binding db.client after the config resolves', () => {
    const context = generateContext(config, data)

    expect(context).toContain(
      "import { resolveRuntimeConnection } from '@opensaas/stack-core/client'",
    )
    expect(context).toContain('...resolveRuntimeConnection(config.db.client),')
    // The factory may only run under the client singleton: the publish and the
    // replacement on a contract change, both behind the resolved config.
    expect(context.match(/createClient\(config\)/g)).toHaveLength(2)
    expect(context).toMatch(/const config = await getConfig\(\)\s[\s\S]*?createClient\(config\)/)
    expect(context).not.toContain('binding?.pg?.()')
  })

  it('installs the stack-owned tripwire as the client’s middleware', () => {
    const context = generateContext(config, data)

    expect(context).toContain("import { originTripwire } from '@opensaas/stack-core/origin'")
    expect(context).toContain('middleware: [originTripwire],')
  })

  it('lists each declared pack’s runtime façade', () => {
    const withPack: ContractData = {
      ...data,
      extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
    }
    const context = generateContext(config, withPack)

    expect(context).toContain(
      "import pgvectorRuntime from '@prisma/orm-extension-pgvector/runtime'",
    )
    expect(context).toContain('extensions: [pgvectorRuntime],')
  })

  it('keeps the client as a module-level singleton, memoised as a promise', () => {
    const context = generateContext(config, data)

    expect(context).toContain('let clientPromise: Promise<RuntimeClient> | null = null')
  })

  it('shares the client across module instances through the process-wide registry, unconditionally', () => {
    const context = generateContext(config, data)

    expect(context).toMatch(
      /import \{ processGlobal\b[^}]*\} from '@opensaas\/stack-core\/internal'/,
    )
    expect(context).toContain("processGlobal('client', isPublishedClient, () => ({")
    expect(context).toContain('contractJson.storage.storageHash')
    expect(context).toContain('contractJson.domain')
    expect(context).toContain('stale.close()')
    // The earlier, dev-only asymmetry this replaced (ADR-0070) must not come back.
    expect(context).not.toContain('NODE_ENV')
    expect(context).not.toContain('globalForClient')
  })

  it('drops the memo when a construction fails, so the next caller retries', () => {
    const context = generateContext(config, data)

    expect(context).toMatch(/if \(clientPromise === attempt\) clientPromise = null\s+throw error/)
  })

  it('drops the raw context memo on failure too, so a failed first pull is not fatal', () => {
    const context = generateContext(config, data)

    expect(context).toMatch(
      /if \(rawContextPromise === attempt\) rawContextPromise = null\s+throw error/,
    )
  })

  it('exposes rawOpensaasContext as a then-able that re-attempts construction, not a plain Promise', () => {
    const context = generateContext(config, data)

    expect(context).toContain('export async function getContext<')
    expect(context).toContain('export const rawOpensaasContext: Promise<Context> = {')
    expect(context).toContain('getRawContext().then(onFulfilled, onRejected)')
    expect(context).toContain('export const config = getConfig()')
  })

  it('marks the raw context as process-lifetime, so its session vocabulary keeps nothing', () => {
    const context = generateContext(config, data)

    expect(context).toContain(
      "import { processGlobal, processLifetimeContext } from '@opensaas/stack-core/internal'",
    )
    expect(context).toMatch(
      /async function buildRawContext\(\)[^]*?return processLifetimeContext\(\s*getOpensaasContext\(/,
    )
    expect(context).not.toMatch(
      /export async function getContext<[^]*?processLifetimeContext[^]*?async function buildRawContext/,
    )
  })

  it('carries .ts extensions on every relative VALUE import (ADR-0054)', () => {
    const context = generateContext(config, data)

    for (const line of context.split('\n')) {
      if (!line.startsWith('import ')) continue
      const relative = line.match(/from '(\.[^']*)'/)
      if (!relative) continue
      // A type-only import is erased, so no loader ever sees its specifier;
      // `contract.d.js` is the spelling that reaches the emitted declarations
      // past the Contract module beside them.
      if (line.startsWith('import type ')) {
        expect(relative[1]).toMatch(/\.(ts|d\.js)$/)
        continue
      }
      expect(relative[1]).toMatch(/\.(ts|json)$/)
    }
  })

  it('follows the resolved cross-references when the bundle is relocated', () => {
    const context = generateContext(config, data, {
      configImport: '../../opensaas.config',
      contractJsonImport: '../../db/contract.json',
    })

    expect(context).toContain("from '../../opensaas.config.ts'")
    expect(context).toContain("from '../../db/contract.json'")
    expect(context).toContain("from '../../db/contract.d.js'")
  })

  it('throws from every storage helper when no provider is configured', () => {
    const context = generateContext(config, data)
    expect(context).toContain('Storage is not configured')
  })

  it('lazily loads the storage runtime when providers are configured', () => {
    const context = generateContext({ ...config, storage: { local: { type: 'local' } } }, data)

    expect(context).toContain("await import('@opensaas/stack-storage/runtime')")
  })

  it('matches the full snapshot', () => {
    expect(generateContext(config, data)).toMatchSnapshot()
  })

  it('wires no framework control-flow predicate into a project without Next', () => {
    const context = generateContext(config, data)

    expect(context).not.toContain('next/')
    expect(context).not.toContain('unstable_rethrow')
    expect(context).not.toContain('isFrameworkControlFlow')
  })

  it('injects Next’s own unstable_rethrow, OR’ed with the config’s, into a Next project', () => {
    const context = generateContext(config, data, {}, { next: true })

    expect(context).toContain(
      "import { controlFlowFromRethrow, eitherControlFlow, processGlobal, processLifetimeContext } from '@opensaas/stack-core/internal'",
    )
    expect(context).toContain("const { unstable_rethrow } = await import('next/navigation')")
    expect(context).toContain('return controlFlowFromRethrow(unstable_rethrow)')
    expect(context).toMatch(
      /const isNextControlFlow = await loadNextControlFlow\(\)\s*resolvedConfig = \{\s*\.\.\.appConfig,[\s\S]*?isFrameworkControlFlow:[\s\S]*?_tables:/,
    )
  })

  it('ORs the app’s predicate through core’s guard, so a throwing one cannot escape the wrapper', () => {
    const context = generateContext(config, data, {}, { next: true })

    expect(context).toContain(
      'isFrameworkControlFlow: eitherControlFlow(isNextControlFlow, appConfig.isFrameworkControlFlow)',
    )
    expect(context).not.toContain('appConfig.isFrameworkControlFlow?.(thrown)')
  })

  it('imports next/navigation only lazily, so the bundle still loads where Next cannot be resolved', () => {
    const context = generateContext(config, data, {}, { next: true })

    expect(context).not.toMatch(/^import .* from 'next\//m)
    expect(context).toMatch(
      /async function loadNextControlFlow\(\)[\s\S]*?catch \{\s*return undefined/,
    )
  })

  it('matches the full snapshot for a Next project', () => {
    expect(generateContext(config, data, {}, { next: true })).toMatchSnapshot()
  })
})

describe('projectDependsOnNext', () => {
  const projectDirs: string[] = []

  afterEach(() => {
    for (const dir of projectDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  function projectWith(manifest: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-next-detect-'))
    projectDirs.push(dir)
    if (manifest !== null) fs.writeFileSync(path.join(dir, 'package.json'), manifest, 'utf-8')
    return dir
  }

  it.each(['dependencies', 'devDependencies', 'peerDependencies'])(
    'is true when %s declares next',
    (key) => {
      expect(
        projectDependsOnNext(projectWith(JSON.stringify({ [key]: { next: '^16.4.2' } }))),
      ).toBe(true)
    },
  )

  it('is false when no dependency map declares next', () => {
    const manifest = JSON.stringify({
      dependencies: { '@opensaas/stack-core': '*', 'next-auth': '*' },
      scripts: { next: 'next dev' },
    })
    expect(projectDependsOnNext(projectWith(manifest))).toBe(false)
  })

  it('is false without a package.json, or with one that does not parse', () => {
    expect(projectDependsOnNext(projectWith(null))).toBe(false)
    expect(projectDependsOnNext(projectWith('{ not json'))).toBe(false)
    expect(projectDependsOnNext(projectWith('null'))).toBe(false)
  })
})
