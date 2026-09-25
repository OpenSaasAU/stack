// Issue #1625: the effective MIME type (declared type for file(), sniffed
// bytes for image()) must drive both the stored extension and the
// Content-Type S3 receives — never the client's own filename. This exercises
// the real `@opensaas/stack-storage` runtime (`uploadFile`/`uploadImage`)
// against S3StorageProvider with a mocked AWS SDK, proving the fix holds
// through a remote provider, not just the local one.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadFile, uploadImage, registerStorageProvider } from '@opensaas/stack-storage/runtime'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { S3StorageProvider, type S3StorageConfig } from '../src/index.js'

vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn().mockResolvedValue({})
  return {
    S3Client: class {
      send = mockSend
    },
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}))

/** A 1x1 PNG — real bytes, so sharp reports its actual detected format. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0xff, 0x3f,
  0x03, 0x00, 0x08, 0xfc, 0x02, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

function makeFile(name: string, type: string, bytes: Uint8Array | string): File {
  const body = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)
  return new File([body], name, { type })
}

const s3Config: S3StorageConfig = { type: 's3', bucket: 'uploads', region: 'us-east-1' }
const config = { storage: { docs: s3Config } } as unknown as OpenSaasConfig

beforeEach(() => {
  registerStorageProvider('s3', (c) => new S3StorageProvider(c as S3StorageConfig))
  vi.clearAllMocks()
})

describe('S3StorageProvider receives the effective type, not the client-declared one', () => {
  it('an .html upload declared application/pdf is put to S3 as a .pdf key with ContentType application/pdf', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const file = makeFile('x.html', 'application/pdf', '<script>alert(document.cookie)</script>')

    const metadata = await uploadFile(
      config,
      'docs',
      { file, buffer: Buffer.from(await file.arrayBuffer()) },
      { validation: { acceptedMimeTypes: ['application/pdf'] } },
    )

    expect(metadata.mimeType).toBe('application/pdf')
    expect(metadata.filename.endsWith('.pdf')).toBe(true)
    expect(vi.mocked(PutObjectCommand)).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.stringMatching(/\.pdf$/),
        ContentType: 'application/pdf',
      }),
    )
  })

  it('PNG bytes declared image/jpeg are put to S3 as a .png key with ContentType image/png', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const file = makeFile('photo.jpg', 'image/jpeg', PNG_BYTES)

    const metadata = await uploadImage(config, 'docs', {
      file,
      buffer: Buffer.from(await file.arrayBuffer()),
    })

    expect(metadata.mimeType).toBe('image/png')
    expect(metadata.filename.endsWith('.png')).toBe(true)
    expect(vi.mocked(PutObjectCommand)).toHaveBeenCalledWith(
      expect.objectContaining({ Key: expect.stringMatching(/\.png$/), ContentType: 'image/png' }),
    )
  })
})
