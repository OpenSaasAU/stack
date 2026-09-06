import { describe, it, expect } from 'vitest'
import type { ContractData, OpenSaasConfig } from '@opensaas/stack-core'
import { deriveContract } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { generateContext } from './context.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: { User: { fields: { name: text() } } },
}

const data: ContractData = deriveContract(config)

describe('generateContext', () => {
  it('constructs the client from the committed contract artifact', () => {
    const context = generateContext(config, data)

    expect(context).toContain("import postgres from '@prisma/orm-postgres/runtime'")
    expect(context).toContain(
      "import contractJson from '../prisma/contract.json' with { type: 'json' }",
    )
    // `.d.js`, not `.d.ts`: the Contract module sits in the same directory and
    // `./contract.d.ts` resolves to IT, not to the emitted declarations.
    expect(context).toContain("import type { Contract } from '../prisma/contract.d.js'")
    expect(context).toContain('postgres<Contract>({')
    expect(context).toContain('contractJson,')
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
    // The factory may only run under the client singleton, so the only call to
    // it sits behind the resolved config.
    expect(context).toContain('const config = await getConfig()\n      const existing =')
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

    expect(context).toContain(
      'let clientPromise: Promise<ReturnType<typeof createClient>> | null = null',
    )
    expect(context).toContain('globalForClient.opensaasClient')
  })

  it('exports getContext, rawOpensaasContext and config', () => {
    const context = generateContext(config, data)

    expect(context).toContain('export async function getContext<')
    expect(context).toContain('export const rawOpensaasContext = (async () => {')
    expect(context).toContain('export const config = getConfig()')
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
})
