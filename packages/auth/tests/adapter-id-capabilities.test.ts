// The adapter factory config's `supportsUUIDs`/`supportsNumericIds` must
// describe the column the generated contract actually emits (#1239) — never
// a hardcoded assumption that can drift from an app's chosen `idField`.

import { describe, expect, it } from 'vitest'
import { config as defineConfig } from '@opensaas/stack-core'
import { authIdCapabilities } from '../src/adapter/index.js'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

describe('authIdCapabilities', () => {
  it('declares supportsUUIDs when the Auth lists resolve to uuid7 (the default)', async () => {
    const built = await defineConfig({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({})],
      lists: {},
    })
    const normalized = built._pluginData?.auth as NormalizedAuthConfig
    const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

    expect(authIdCapabilities(built, registry)).toEqual({
      supportsUUIDs: true,
      supportsNumericIds: false,
    })
  })

  it('declares supportsUUIDs: false when the Auth lists resolve to cuid2', async () => {
    const built = await defineConfig({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({ idField: 'cuid2' })],
      lists: {},
    })
    const normalized = built._pluginData?.auth as NormalizedAuthConfig
    const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

    expect(authIdCapabilities(built, registry)).toEqual({
      supportsUUIDs: false,
      supportsNumericIds: false,
    })
  })

  it('follows an app-wide cuid2 default with no explicit authPlugin idField', async () => {
    const built = await defineConfig({
      db: { provider: 'postgresql', idField: 'cuid2' },
      plugins: [authPlugin({})],
      lists: {},
    })
    const normalized = built._pluginData?.auth as NormalizedAuthConfig
    const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

    expect(authIdCapabilities(built, registry)).toEqual({
      supportsUUIDs: false,
      supportsNumericIds: false,
    })
  })
})
