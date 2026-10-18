import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  uploadImage,
  registerStorageProvider,
  resetStorageProviderRegistry,
} from '../src/runtime/index.js'
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  BaseStorageConfig,
} from '../src/config/types.js'

interface FlakyStorageConfig extends BaseStorageConfig {
  type: 'flaky'
}

let failOnUpload: number
let uploaded: string[]
let deleted: string[]

class FlakyStorageProvider implements StorageProvider {
  constructor(public readonly config: FlakyStorageConfig) {}

  async upload(
    _file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    if (uploaded.length + 1 === failOnUpload) throw new Error('upload failed')
    uploaded.push(filename)
    return {
      filename,
      url: `/flaky/${filename}`,
      size: 0,
      contentType: options?.contentType ?? 'application/octet-stream',
    }
  }

  async download(): Promise<Buffer> {
    return Buffer.from('')
  }

  async delete(filename: string): Promise<void> {
    deleted.push(filename)
  }

  getUrl(filename: string): string {
    return `/flaky/${filename}`
  }
}

const config = {
  storage: { flaky: { type: 'flaky' } as FlakyStorageConfig },
} as unknown as OpenSaasConfig

const transformations = {
  small: { width: 1, height: 1 },
  large: { width: 1, height: 1 },
}

async function upload() {
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer()
  const file = new File([bytes], 'a.png', { type: 'image/png' })
  return uploadImage(
    config,
    'flaky',
    { file, buffer: Buffer.from(await file.arrayBuffer()) },
    { transformations },
  )
}

beforeEach(() => {
  resetStorageProviderRegistry()
  registerStorageProvider('flaky', (c) => new FlakyStorageProvider(c as FlakyStorageConfig))
  uploaded = []
  deleted = []
  failOnUpload = 0
})

describe('uploadImage: a failing transformation leaves nothing behind', () => {
  it('deletes the original and earlier variants when a later variant upload fails', async () => {
    failOnUpload = 3
    await expect(upload()).rejects.toThrow('upload failed')
    expect(uploaded).toHaveLength(2)
    expect([...deleted].sort()).toEqual([...uploaded].sort())
  })

  it('deletes the original when the first variant upload fails', async () => {
    failOnUpload = 2
    await expect(upload()).rejects.toThrow('upload failed')
    expect(deleted).toEqual(uploaded)
    expect(uploaded).toHaveLength(1)
  })

  it('rethrows the original error even when cleanup itself fails', async () => {
    failOnUpload = 3
    FlakyStorageProvider.prototype.delete = async () => {
      throw new Error('delete failed')
    }
    await expect(upload()).rejects.toThrow('upload failed')
  })
})
