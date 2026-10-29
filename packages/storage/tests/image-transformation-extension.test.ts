import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  uploadImage,
  registerStorageProvider,
  resetStorageProviderRegistry,
} from '../src/runtime/index.js'
import type { StorageProvider, UploadResult, BaseStorageConfig } from '../src/config/types.js'

interface RecordingStorageConfig extends BaseStorageConfig {
  type: 'recording'
}

let uploaded: string[]

class RecordingStorageProvider implements StorageProvider {
  constructor(public readonly config: RecordingStorageConfig) {}

  async upload(_file: Buffer | Uint8Array, filename: string): Promise<UploadResult> {
    uploaded.push(filename)
    return { filename, url: `/rec/${filename}`, size: 0, contentType: 'image/png' }
  }

  async download(): Promise<Buffer> {
    return Buffer.from('')
  }

  async delete(): Promise<void> {}

  getUrl(filename: string): string {
    return `/rec/${filename}`
  }
}

const config = {
  storage: { recording: { type: 'recording' } as RecordingStorageConfig },
} as unknown as OpenSaasConfig

async function uploadWith(transformations: Parameters<typeof uploadImage>[3]['transformations']) {
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer()
  const file = new File([bytes], 'photo.png', { type: 'image/png' })
  return uploadImage(
    config,
    'recording',
    { file, buffer: Buffer.from(await file.arrayBuffer()) },
    { transformations },
  )
}

beforeEach(() => {
  resetStorageProviderRegistry()
  registerStorageProvider(
    'recording',
    (c) => new RecordingStorageProvider(c as RecordingStorageConfig),
  )
  uploaded = []
})

describe('uploadImage: variant file extensions', () => {
  it('stores a variant without a format under the original extension', async () => {
    await uploadWith({ thumb: { width: 1, height: 1 } })
    const [original, variant] = uploaded
    expect(original).toMatch(/\.png$/)
    expect(variant).toMatch(/-thumb\.png$/)
  })

  it('stores a variant with a format under that format extension', async () => {
    await uploadWith({ thumb: { width: 1, height: 1, format: 'webp' } })
    expect(uploaded[1]).toMatch(/-thumb\.webp$/)
  })

  it('keeps variants distinct when the variant name contains a dot', async () => {
    await uploadWith({ thumb: { width: 2, height: 2 }, 'thumb.2x': { width: 1, height: 1 } })
    expect(new Set(uploaded).size).toBe(3)
  })
})
