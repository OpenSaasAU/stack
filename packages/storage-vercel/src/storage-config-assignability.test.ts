import { describe, it } from 'vitest'
import type { BaseStorageConfig } from '@opensaas/stack-storage'
import type { VercelBlobStorageConfig } from './index.js'

/**
 * Pins `VercelBlobStorageConfig`'s assignability to core's
 * `BaseStorageConfig`. Checked by `tsc` over `src/**` (the package build),
 * not at runtime.
 */
describe('VercelBlobStorageConfig assignability', () => {
  it('is assignable to BaseStorageConfig', () => {
    const assertAssignable = (config: VercelBlobStorageConfig): BaseStorageConfig => config
    void assertAssignable
  })
})
