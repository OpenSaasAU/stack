import { describe, expect, test } from 'vitest'
import { config as defineConfig } from '@opensaas/stack-core'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { buildBetterAuthOptions } from '../src/server/index.js'
import type { AuthConfig } from '../src/config/types.js'

async function configWith(betterAuthOptions: AuthConfig['betterAuthOptions']) {
  return (await defineConfig({
    plugins: [authPlugin({ emailAndPassword: { enabled: true }, betterAuthOptions })],
    db: { provider: 'postgresql' },
    lists: {},
  })) as OpenSaasConfig
}

/**
 * The guard runs before the adapter is built, so a context that carries no
 * Unsafe surface is enough to reach it — and any refusal that does not fire
 * shows up as the surface's own error instead.
 */
const contextWithoutSurface = {} as AccessContext

describe('refused passthrough keys', () => {
  test('advanced.database.generateId as a custom function throws at config time', async () => {
    const config = await configWith({ advanced: { database: { generateId: () => 'nope' } } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /advanced\.database\.generateId` does not support/,
    )
  })

  test("advanced.database.generateId: 'serial' throws at config time", async () => {
    const config = await configWith({ advanced: { database: { generateId: 'serial' } } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /advanced\.database\.generateId` does not support/,
    )
  })

  test('advanced.database.joins throws at config time', async () => {
    const config = await configWith({ advanced: { database: { joins: true } } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /advanced\.database\.joins` is not supported/,
    )
  })

  test('database stays refused', async () => {
    const config = await configWith({ database: { dialect: 'unused' } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /`betterAuthOptions\.database` is not supported/,
    )
  })

  test('an unrelated advanced.database key passes through', async () => {
    const config = await configWith({ advanced: { database: { defaultFindManyLimit: 25 } } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /carries no Unsafe surface/,
    )
  })
})

describe('accepted advanced.database.generateId values', () => {
  test.each([
    ['false', false],
    ["'uuid'", 'uuid' as const],
    ['undefined', undefined],
  ])('generateId: %s passes through', async (_label, generateId) => {
    const config = await configWith({ advanced: { database: { generateId } } })
    await expect(buildBetterAuthOptions(config, contextWithoutSurface)).rejects.toThrow(
      /carries no Unsafe surface/,
    )
  })
})
