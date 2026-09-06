import type { ContractData, OpenSaasConfig } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'
import { withTsExtension } from './extension.js'

/**
 * The relative specifiers the generated context embeds, resolved by
 * {@link resolveOutputPaths} so the bundle and the Contract module can each be
 * relocated.
 */
export interface ContextReferences {
  /** Specifier for `opensaas.config`, relative to the bundle directory. */
  configImport: string
  /** Specifier for the emitted `contract.json`, relative to the bundle directory. */
  contractJsonImport: string
}

const DEFAULT_REFERENCES: ContextReferences = {
  configImport: '../opensaas.config',
  contractJsonImport: '../prisma/contract.json',
}

/**
 * The `contract.d.ts` beside a `contract.json`, as a type-only specifier.
 *
 * Spelled `.d.js`, not `.d.ts`: the Contract module (`prisma/contract.ts`)
 * sits in the same directory, and TypeScript resolves `./contract.d.ts` to
 * THAT file, so the import lands on the builder module and `Contract` is not
 * among its exports. `./contract.d.js` takes the standard `.js` -> `.d.ts`
 * mapping and reaches the emitted declarations. The import is type-only and
 * erased, so no loader ever sees the specifier — ADR-0054's `.ts` rule is
 * about value imports.
 */
function contractTypesImport(contractJsonImport: string): string {
  return contractJsonImport.replace(/contract\.json$/, 'contract.d.js')
}

function storageUtilities(config: OpenSaasConfig): string {
  const hasStorage = !!config.storage && Object.keys(config.storage).length > 0
  if (!hasStorage) {
    return `
const storage = {
  uploadFile: async () => {
    throw new Error('Storage is not configured. Add storage providers to your opensaas.config.ts')
  },
  uploadImage: async () => {
    throw new Error('Storage is not configured. Add storage providers to your opensaas.config.ts')
  },
  deleteFile: async () => {
    throw new Error('Storage is not configured. Add storage providers to your opensaas.config.ts')
  },
  deleteImage: async () => {
    throw new Error('Storage is not configured. Add storage providers to your opensaas.config.ts')
  },
}
`
  }

  return `
// Lazily loaded so sharp and the other storage dependencies stay out of a
// client bundle that only reaches the context for its types.
let storageRuntime: typeof import('@opensaas/stack-storage/runtime') | null = null

async function getStorageRuntime() {
  if (!storageRuntime) {
    try {
      storageRuntime = await import('@opensaas/stack-storage/runtime')
    } catch (error) {
      throw new Error(
        'Failed to load @opensaas/stack-storage/runtime. Make sure @opensaas/stack-storage is installed.'
      )
    }
  }
  return storageRuntime
}

const storage = {
  uploadFile: async (providerName: string, file: File, buffer: Buffer, options?: unknown) => {
    const config = await getConfig()
    const runtime = await getStorageRuntime()
    return runtime.uploadFile(config, providerName, { file, buffer }, options as any)
  },

  uploadImage: async (providerName: string, file: File, buffer: Buffer, options?: unknown) => {
    const config = await getConfig()
    const runtime = await getStorageRuntime()
    return runtime.uploadImage(config, providerName, { file, buffer }, options as any)
  },

  deleteFile: async (providerName: string, filename: string) => {
    const config = await getConfig()
    const runtime = await getStorageRuntime()
    return runtime.deleteFile(config, providerName, filename)
  },

  deleteImage: async (metadata: unknown) => {
    const config = await getConfig()
    const runtime = await getStorageRuntime()
    return runtime.deleteImage(config, metadata as any)
  },
}
`
}

/**
 * Render `<opensaasDir>/context.ts` — the generated context factory.
 *
 * The client is constructed from the committed `contract.json`, so the runtime
 * executes the same bytes the emitted artifacts were signed over (PRD user
 * story 6), with the stack-owned tripwire in `middleware` and each declared
 * pack's runtime façade in `extensions`. Its connection is
 * `resolveRuntimeConnection`'s: `db.client.pg` when the config supplies a pool
 * factory, otherwise the stack's URL lookup, whose provenance decides the
 * Dev database's single-connection binding (ADR-0049, ADR-0063).
 *
 * The resolved config carries the emitted dependency-set table and
 * unique-constraint map from `tables.ts` on `_tables`, which is how the
 * engine reaches them (ADR-0051, ADR-0042).
 *
 * Known limits:
 * - `Context` is still the bundle's own type; #1136 rewrites `types.ts` to
 *   instantiate core's contract-keyed generics, and the client's own typed
 *   surface is spec 2's.
 * - Pool lifecycle beyond the module-level singleton — `close()`, the dev
 *   loop's ephemeral database, the pooled/direct split — is still unowned. The
 *   pool `resolveRuntimeConnection` builds for that database is bound as `pg`,
 *   which rc.8 gives no `ownedDispose`, so nothing ends it; it carries a
 *   connection timeout instead of relying on one.
 */
export function generateContext(
  config: OpenSaasConfig,
  data: ContractData,
  references: Partial<ContextReferences> = {},
): string {
  const { configImport, contractJsonImport } = { ...DEFAULT_REFERENCES, ...references }
  const configImportPath = withTsExtension(configImport)
  const contractTypesPath = contractTypesImport(contractJsonImport)

  const runtimeExtensionImports = data.extensions
    .map((extension) => `import ${extension.name}Runtime from '${extension.from}/runtime'`)
    .join('\n')
  const runtimeExtensions = data.extensions
    .map((extension) => `${extension.name}Runtime`)
    .join(', ')

  return `/**
 * Auto-generated context factory
 *
 * DO NOT EDIT - This file is automatically generated by 'pnpm generate'
 */

import { getContext as getOpensaasContext } from '@opensaas/stack-core'
import { resolveRuntimeConnection } from '@opensaas/stack-core/client'
import { originTripwire } from '@opensaas/stack-core/origin'
import type { OrmClient } from '@opensaas/stack-core'
import type { Session as OpensaasSession, OpenSaasConfig } from '@opensaas/stack-core'
import postgres from '@prisma/orm-postgres/runtime'
${runtimeExtensionImports}${runtimeExtensionImports ? '\n' : ''}import type { Contract } from '${contractTypesPath}'
import contractJson from '${contractJsonImport}' with { type: 'json' }
import type { Context } from './types.ts'
import { constraintMap, dependencyTable } from './tables.ts'
import configOrPromise from '${configImportPath}'

// Resolve config if it's a Promise (when plugins are present)
const configPromise = Promise.resolve(configOrPromise)
let resolvedConfig: OpenSaasConfig | null = null

/**
 * The ORM client, built from the committed contract artifact rather than from
 * a generated client tree, so the runtime executes exactly the structure the
 * emitted contract describes.
 *
 * \`resolveRuntimeConnection\` calls \`db.client.pg\` and reads the URL lookup, so
 * this runs once per process, under the singleton below, and never on a config
 * load: nothing that only reads the config opens a connection.
 */
function createClient(config: OpenSaasConfig) {
  return postgres<Contract>({
    contractJson,
    extensions: [${runtimeExtensions}],
    middleware: [originTripwire],
    ...resolveRuntimeConnection(config.db.client),
  })
}

const globalForClient = globalThis as unknown as { opensaasClient: ReturnType<typeof createClient> | null }
let clientPromise: Promise<ReturnType<typeof createClient>> | null = null

function getClient() {
  if (clientPromise) return clientPromise
  // Memoised as the promise, not the resolved client: two requests racing the
  // config's own await would otherwise each construct a client, and each call
  // \`db.client.pg\` a second time. The memo is dropped again on failure, so a
  // process that starts before its database does can still reach one — the
  // connection URL is read at construction, not at import.
  const attempt = (async () => {
    const config = await getConfig()
    const existing = globalForClient.opensaasClient
    if (existing) return existing
    const created = createClient(config)
    if (process.env.NODE_ENV !== 'production') globalForClient.opensaasClient = created
    return created
  })().catch((error: unknown) => {
    if (clientPromise === attempt) clientPromise = null
    throw error
  })
  clientPromise = attempt
  return attempt
}

/**
 * The app's config carrying the emitted tables. This is the door the engine
 * reads them through (ADR-0051): it widens a read for a computed field's
 * declared dependencies, and resolves a unique violation to per-field
 * messages, from the generated facts rather than by walking the config.
 */
async function getConfig() {
  if (!resolvedConfig) {
    resolvedConfig = {
      ...(await configPromise),
      _tables: { dependencies: dependencyTable, constraints: constraintMap },
    }
  }
  return resolvedConfig
}

/**
 * The engine still reaches a model by key (\`client.post.findMany\`) — the Prisma 7
 * shape — while a Prisma 8 client exposes its collections at
 * \`db.orm.<namespace>.<Model>\`. Reconciling the two is the runtime spec's
 * (ADR-0041, ADR-0039); until then the client crosses into the engine here, in
 * one named place, rather than at every call site.
 */
function asOrmClient(value: ReturnType<typeof createClient>): OrmClient {
  return value as unknown as OrmClient
}
${storageUtilities(config)}
/**
 * Get OpenSaas context with optional session
 *
 * @param session - Optional session object (structure defined by your application)
 *
 * @example
 * \`\`\`typescript
 * // Anonymous access
 * const context = await getContext()
 * const posts = await context.db.post.findMany()
 *
 * // Authenticated access
 * const context = await getContext({ userId: 'user-123' })
 * const myPosts = await context.db.post.findMany()
 * \`\`\`
 */
export async function getContext<TSession extends OpensaasSession = OpensaasSession>(session?: TSession): Promise<Context<TSession>> {
  const config = await getConfig()
  const db = await getClient()
  return getOpensaasContext(config, asOrmClient(db), session ?? null, storage, false, undefined, undefined, db) as unknown as Context<TSession>
}

/**
 * Raw context as a Promise, for module-init-time consumers that can't \`await\` directly
 * (e.g., Better-auth setup). Resolves once config and the client are ready.
 * Pass this promise itself to helpers like \`createAuth\` that defer real construction
 * behind a lazy Proxy until it resolves - do not await it at module scope.
 */
export const rawOpensaasContext = (async () => {
  const config = await getConfig()
  const db = await getClient()
  return getOpensaasContext(config, asOrmClient(db), null, storage, false, undefined, undefined, db) as unknown as Context
})()

// This one is pulled during module evaluation, so a database that isn't up yet
// rejects it before any consumer has attached a handler, and Node's default
// \`--unhandled-rejections=throw\` would take the process down (Node >= 15) —
// killing the retry the dropped memo above exists to allow. Marking it handled
// changes nothing for a real consumer: awaiting it still throws.
void rawOpensaasContext.catch(() => {})

/**
 * Re-export resolved config for use in admin pages and server actions
 * This is a promise that resolves to the config
 */
export const config = getConfig()
`
}

export function writeContext(
  config: OpenSaasConfig,
  data: ContractData,
  outputPath: string,
  references?: Partial<ContextReferences>,
): void {
  const content = generateContext(config, data, references)

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content, 'utf-8')
}
