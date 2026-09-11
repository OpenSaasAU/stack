import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { ImageMetadata } from '@opensaas/stack-core/internal'
import {
  createStorageUtils,
  registerStorageProvider,
  resetStorageProviderRegistry,
} from '../src/runtime/index.js'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  BaseStorageConfig,
} from '../src/config/types.js'

/**
 * `StorageUtils.deleteImage` takes `unknown` — core cannot name this package's
 * types — so the factory is the only place the shape is established. A
 * `value is T` predicate is taken on trust by the compiler, so what it omits
 * is a claim nothing checks: the omitted `storageProvider` is the very member
 * `deleteImage` dereferences first.
 *
 * Both directions matter. Accepting valid metadata keeps the surface usable;
 * rejecting an invalid shape keeps a Test context from being *quieter* than an
 * application, which is the one failure a test harness must not have.
 */

interface FakeStorageConfig extends BaseStorageConfig {
  type: 'fake'
}

const deleted: string[] = []

class FakeStorageProvider implements StorageProvider {
  constructor(public readonly config: FakeStorageConfig) {}

  async upload(
    _file: Buffer | Uint8Array,
    filename: string,
    _options?: UploadOptions,
  ): Promise<UploadResult> {
    return { filename, url: `/fake/${filename}`, size: 0 }
  }

  async delete(filename: string): Promise<void> {
    deleted.push(filename)
  }

  getUrl(filename: string): string {
    return `/fake/${filename}`
  }
}

const config = {
  storage: { fake: { type: 'fake' } as FakeStorageConfig },
} as unknown as OpenSaasConfig

/** Every required member of `ImageMetadata`, and nothing optional. */
const VALID: ImageMetadata = {
  filename: 'photo.png',
  originalFilename: 'holiday.png',
  url: '/fake/photo.png',
  mimeType: 'image/png',
  size: 1024,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  storageProvider: 'fake',
  width: 800,
  height: 600,
}

beforeEach(() => {
  resetStorageProviderRegistry()
  registerStorageProvider('fake', (c) => new FakeStorageProvider(c as FakeStorageConfig))
  deleted.length = 0
})

describe('createStorageUtils().deleteImage', () => {
  it('accepts complete metadata and deletes through the named provider', async () => {
    await createStorageUtils(config).deleteImage(VALID)

    expect(deleted).toEqual(['photo.png'])
  })

  it('accepts metadata carrying optional transformations, and deletes each variant', async () => {
    await createStorageUtils(config).deleteImage({
      ...VALID,
      metadata: { uploadedBy: 'ada' },
      transformations: {
        thumbnail: { url: '/fake/photo-thumb.webp', width: 300, height: 200, size: 64 },
      },
    })

    expect(deleted).toEqual(['photo.png', 'photo-thumb.webp'])
  })

  // Every required member, one at a time: dropping any of the nine must be a
  // rejection, because the predicate claims all nine.
  it.each(Object.keys(VALID))('rejects metadata missing %s', async (member) => {
    const incomplete = { ...VALID }
    delete (incomplete as Record<string, unknown>)[member]

    await expect(createStorageUtils(config).deleteImage(incomplete)).rejects.toThrow(
      /deleteImage expected ImageMetadata/,
    )
    expect(deleted).toEqual([])
  })

  it.each([
    ['a wrong-typed required member', { ...VALID, width: '800' }],
    ['a null required member', { ...VALID, storageProvider: null }],
    ['a malformed transformation entry', { ...VALID, transformations: { thumb: { url: 1 } } }],
    ['a non-record transformations map', { ...VALID, transformations: 'none' }],
    ['a non-record metadata bag', { ...VALID, metadata: 'none' }],
  ])('rejects %s', async (_label, value) => {
    await expect(createStorageUtils(config).deleteImage(value)).rejects.toThrow(
      /deleteImage expected ImageMetadata/,
    )
    expect(deleted).toEqual([])
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'photo.png'],
    ['a number', 7],
    ['an empty object', {}],
    // The exact shape the review measured: it satisfied the old two-member
    // predicate and reached the provider registry as `undefined`.
    ['the two-member shape the old guard admitted', { filename: 'x.png', url: '/u/x.png' }],
    ['an unrecognised object', { nothing: true }],
  ])('rejects %s rather than resolving silently', async (_label, value) => {
    const utils = createStorageUtils(config)

    await expect(utils.deleteImage(value)).rejects.toThrow(/deleteImage expected ImageMetadata/)
    expect(deleted).toEqual([])
  })

  it('names what it received, so the failure is diagnosable', async () => {
    await expect(
      createStorageUtils(config).deleteImage({ filename: 'x.png', url: '/u/x.png' }),
    ).rejects.toThrow(/an object with keys: filename, url/)
  })

  it('does not reach the provider registry for an invalid shape', async () => {
    // The old guard's failure mode was a confusing throw from deep inside the
    // registry — `Storage provider 'undefined' not found in config` — rather
    // than a refusal at the boundary.
    const spy = vi.fn()
    resetStorageProviderRegistry()
    registerStorageProvider('fake', (c) => {
      spy()
      return new FakeStorageProvider(c as FakeStorageConfig)
    })

    await expect(
      createStorageUtils(config).deleteImage({ filename: 'x.png', url: '/u/x.png' }),
    ).rejects.toThrow(/deleteImage expected ImageMetadata/)
    expect(spy).not.toHaveBeenCalled()
  })
})
