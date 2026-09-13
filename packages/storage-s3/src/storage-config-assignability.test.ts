import { describe, it } from 'vitest'
import type { BaseStorageConfig } from '@opensaas/stack-storage'
import type { S3StorageConfig } from './index.js'

/**
 * Pins `S3StorageConfig`'s assignability to core's `BaseStorageConfig`.
 * Checked by `tsc` over `src/**` (the package build), not at runtime.
 */
describe('S3StorageConfig assignability', () => {
  it('is assignable to BaseStorageConfig', () => {
    const assertAssignable = (config: S3StorageConfig): BaseStorageConfig => config
    void assertAssignable
  })
})
