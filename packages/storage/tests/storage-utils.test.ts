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

// `mediaType` stands in for the bytes sharp actually decodes, which
// `uploadImage` now trusts over the caller's declared type (issue #1625) —
// every test file here declares `image/png`, so the mock echoes it back.
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, mediaType: 'image/png' }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    avif: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('transformed-image-data')),
  }))

  return { default: mockSharp }
})

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
    return { filename, url: `/fake/${filename}`, size: 0, contentType: 'application/octet-stream' }
  }

  async download(_filename: string): Promise<Buffer> {
    return Buffer.from('')
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

/**
 * `StorageUtils.uploadFile`/`uploadImage` also take `options: unknown`, and
 * `uploadFileOptions` narrowed `options.validation` to `FileValidationOptions`
 * while checking that it was an object and nothing else: `{ maxFileSize: 'one
 * megabyte', acceptedMimeTypes: 42 }` reached `validateFile` as real options,
 * where a size comparison against a string and an `includes` check against a
 * number are both no-ops — validation silently disabled instead of refused.
 */
function makeFile(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' })
}

describe('createStorageUtils().uploadFile', () => {
  it('uploads when no options are given', async () => {
    const metadata = await createStorageUtils(config).uploadFile(
      'fake',
      makeFile(10),
      Buffer.from('data'),
    )
    expect(metadata).toMatchObject({ filename: 'photo.png' })
  })

  it('applies real validation: a file over maxFileSize is rejected, not silently allowed', async () => {
    await expect(
      createStorageUtils(config).uploadFile('fake', makeFile(2000), Buffer.from('data'), {
        validation: { maxFileSize: 1000 },
      }),
    ).rejects.toThrow(/File size exceeds maximum/)
  })

  it('applies real validation: an accepted MIME type list still rejects a mismatch', async () => {
    await expect(
      createStorageUtils(config).uploadFile('fake', makeFile(10), Buffer.from('data'), {
        validation: { acceptedMimeTypes: ['application/pdf'] },
      }),
    ).rejects.toThrow(/is not allowed/)
  })

  it('uploads when validation options are well-typed and satisfied', async () => {
    const metadata = await createStorageUtils(config).uploadFile(
      'fake',
      makeFile(10),
      Buffer.from('data'),
      { validation: { maxFileSize: 1000, acceptedMimeTypes: ['image/png'] } },
    )
    expect(metadata).toMatchObject({ filename: 'photo.png' })
  })

  it.each([
    ['maxFileSize as a string', { maxFileSize: 'one megabyte' }],
    [
      'maxFileSize as a string and acceptedMimeTypes as a number',
      { maxFileSize: 'one megabyte', acceptedMimeTypes: 42 },
    ],
    ['acceptedMimeTypes as a number', { acceptedMimeTypes: 42 }],
    ['acceptedMimeTypes with a non-string entry', { acceptedMimeTypes: ['image/png', 42] }],
    ['acceptedExtensions as a string', { acceptedExtensions: '.png' }],
  ])(
    'refuses validation options with %s rather than silently disabling validation',
    async (_label, validation) => {
      // A file that violates no *correctly-typed* rule, so a guard that checks
      // nothing would let this call through and prove nothing either way.
      await expect(
        createStorageUtils(config).uploadFile('fake', makeFile(10), Buffer.from('data'), {
          validation,
        }),
      ).rejects.toThrow(/uploadFile validation options must be/)
    },
  )

  it('names what it received', async () => {
    await expect(
      createStorageUtils(config).uploadFile('fake', makeFile(10), Buffer.from('data'), {
        validation: { maxFileSize: 'one megabyte' },
      }),
    ).rejects.toThrow(/an object with keys: maxFileSize/)
  })
})

describe('createStorageUtils().uploadImage', () => {
  it('uploads with no transformations', async () => {
    const metadata = await createStorageUtils(config).uploadImage(
      'fake',
      makeFile(10),
      Buffer.from('data'),
    )
    expect(metadata).toMatchObject({ filename: 'photo.png' })
  })

  it('uploads and applies a well-typed transformation', async () => {
    const metadata = await createStorageUtils(config).uploadImage(
      'fake',
      makeFile(10),
      Buffer.from('data'),
      { transformations: { thumbnail: { width: 100, height: 100, fit: 'cover' } } },
    )
    expect(metadata).toMatchObject({ filename: 'photo.png' })
  })

  it.each([
    ['a non-record transformations map', 'thumbnail'],
    ['a non-record transformation entry', { thumbnail: 'cover' }],
    ['width as a string', { thumbnail: { width: '100' } }],
    ['fit outside the enum', { thumbnail: { fit: 'zoom' } }],
    ['format outside the enum', { thumbnail: { format: 'bmp' } }],
    ['quality as a string', { thumbnail: { quality: 'high' } }],
    // NaN/Infinity pass a bare `typeof x === 'number'` check, and
    // `transformImage`'s own `transformation.width || transformation.height`
    // and `quality || 80` fallbacks then treat NaN as falsy — silently
    // dropping the dimension or quality the caller asked for.
    ['width as NaN', { thumbnail: { width: NaN } }],
    ['quality as Infinity', { thumbnail: { quality: Infinity } }],
    ['an array instead of a config object', { thumbnail: [100, 100] }],
    // Vacuously true under a bare `key === undefined || …` check: no known
    // key is set, so a typo'd key would otherwise sail through unenforced.
    ['a misspelled key', { thumbnail: { withd: 100 } }],
  ])(
    'refuses transformations with %s rather than silently disabling them',
    async (_label, transformations) => {
      await expect(
        createStorageUtils(config).uploadImage('fake', makeFile(10), Buffer.from('data'), {
          transformations,
        }),
      ).rejects.toThrow(/uploadImage transformation/)
    },
  )
})
