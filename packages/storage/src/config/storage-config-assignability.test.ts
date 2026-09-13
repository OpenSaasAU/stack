import { describe, it } from 'vitest'
import type { BaseStorageConfig, LocalStorageConfig } from './types.js'

/**
 * Every provider config must be assignable to `BaseStorageConfig` — the type
 * `StorageConfig` maps provider names onto. Checked by `tsc` over `src/**`
 * (the package build), not at runtime.
 */
describe('storage provider config assignability', () => {
  it('LocalStorageConfig is assignable to BaseStorageConfig', () => {
    const assertAssignable = (config: LocalStorageConfig): BaseStorageConfig => config
    void assertAssignable
  })
})
