import type { OpenSaasConfig } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'
import { withTsExtension } from './extension.js'

/**
 * Generate context factory that abstracts Prisma client from developers
 *
 * Creates a simple API with getContext() and getContextWithSession(session)
 * that internally handles Prisma singleton and config imports.
 */
export function generateContext(config: OpenSaasConfig, configImport?: string): string {
  // Module specifier for importing the project's opensaas.config from inside
  // the `.opensaas` bundle. Defaults to the legacy `../opensaas.config` (bundle
  // one level below the project root); the output-path resolver supplies a
  // recomputed value when the bundle is relocated via the `output` config block.
  //
  // The explicit `.ts` extension (see ./extension.ts) makes the bundle loadable
  // by the host bundler / plain Node without an `extensionAlias`. The user's
  // `opensaas.config.ts` is a real `.ts` file, so `.ts` names it directly.
  const configImportPath = withTsExtension(configImport ?? '../opensaas.config')

  // Check if custom Prisma client constructor is provided
  const hasCustomConstructor = !!config.db.prismaClientConstructor

  // Check if storage is configured
  const hasStorage = !!config.storage && Object.keys(config.storage).length > 0

  // Generate the Prisma client instantiation code
  // Prisma 7 requires adapters, so prismaClientConstructor must be provided
  const prismaInstantiation = hasCustomConstructor
    ? `resolvedConfig.db.prismaClientConstructor!(PrismaClient)`
    : `(() => {
      throw new Error(
        'Prisma 7 requires a database adapter. Please add prismaClientConstructor to your opensaas.config.ts db configuration.\\n\\n' +
        'Example for SQLite:\\n' +
        'import { PrismaBetterSqlite3 } from \\'@prisma/adapter-better-sqlite3\\'\\n\\n' +
        'db: {\\n' +
        '  provider: \\'sqlite\\',\\n' +
        '  url: process.env.DATABASE_URL || \\'file:./dev.db\\',\\n' +
        '  prismaClientConstructor: (PrismaClient) => {\\n' +
        '    const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || \\'file:./dev.db\\' })\\n' +
        '    return new PrismaClient({ adapter })\\n' +
        '  }\\n' +
        '}\\n\\n' +
        'See https://www.prisma.io/docs/orm/overview/databases/database-drivers for more information.'
      )
    })()`

  // Generate storage utilities if storage is configured
  const storageUtilities = hasStorage
    ? `
/**
 * Lazy-loaded storage runtime functions
 * Prevents sharp and other storage dependencies from being bundled in client code
 */
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

/**
 * Storage utilities for file/image uploads
 */
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
    : `
/**
 * Storage utilities (not configured)
 */
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

  // Always use async version for consistency
  return `/**
 * Auto-generated context factory
 *
 * This module provides a simple API for creating OpenSaas contexts.
 * It abstracts away Prisma client management and configuration.
 *
 * DO NOT EDIT - This file is automatically generated by 'pnpm generate'
 */

import { getContext as getOpensaasContext } from '@opensaas/stack-core'
import type { Session as OpensaasSession, OpenSaasConfig } from '@opensaas/stack-core'
import { PrismaClient } from './prisma-client/client.ts'
import type { Context } from './types.ts'
import { prismaExtensions } from './prisma-extensions.ts'
import configOrPromise from '${configImportPath}'

// Resolve config if it's a Promise (when plugins are present)
const configPromise = Promise.resolve(configOrPromise)
let resolvedConfig: OpenSaasConfig | null = null

// Internal Prisma singleton - managed automatically
const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createExtendedPrisma> | null }
let prisma: ReturnType<typeof createExtendedPrisma> | null = null

/**
 * Create Prisma client with result extensions
 */
function createExtendedPrisma(basePrisma: PrismaClient) {
  // Check if there are any extensions to apply
  if (Object.keys(prismaExtensions).length === 0) {
    return basePrisma
  }
  // Apply result extensions
  return basePrisma.$extends(prismaExtensions)
}

async function getPrisma() {
  if (!prisma) {
    if (!resolvedConfig) {
      resolvedConfig = await configPromise
    }
    const basePrisma = ${prismaInstantiation}
    const extendedPrisma = createExtendedPrisma(basePrisma)
    prisma = globalForPrisma.prisma ?? extendedPrisma
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
  }
  return prisma
}

async function getConfig() {
  if (!resolvedConfig) {
    resolvedConfig = await configPromise
  }
  return resolvedConfig
}
${storageUtilities}
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
 *
 * // With custom session type
 * type CustomSession = { userId: string; email: string; role: string } | null
 * const context = await getContext<CustomSession>({ userId: '123', email: 'user@example.com', role: 'admin' })
 * // context.session is now typed as CustomSession
 * \`\`\`
 */
export async function getContext<TSession extends OpensaasSession = OpensaasSession>(session?: TSession): Promise<Context<TSession>> {
  const config = await getConfig()
  const prismaClient = await getPrisma()
  return getOpensaasContext(config, prismaClient, session ?? null, storage) as unknown as Context<TSession>
}

/**
 * Raw context for synchronous initialization (e.g., Better-auth setup)
 * This is only available after config is resolved, use with caution
 */
export const rawOpensaasContext = (async () => {
  const config = await getConfig()
  const prismaClient = await getPrisma()
  return getOpensaasContext(config, prismaClient, null, storage) as unknown as Context
})()

/**
 * Re-export resolved config for use in admin pages and server actions
 * This is a promise that resolves to the config
 */
export const config = getConfig()
`
}

/**
 * Write context factory to file
 *
 * @param configImport - Optional override for the `opensaas.config` import
 *   specifier, forwarded to {@link generateContext}.
 */
export function writeContext(
  config: OpenSaasConfig,
  outputPath: string,
  configImport?: string,
): void {
  const content = generateContext(config, configImport)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content, 'utf-8')
}
