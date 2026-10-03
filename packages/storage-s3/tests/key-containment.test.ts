import { describe, it, expect, vi } from 'vitest'
import { S3StorageProvider } from '../src/index.js'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn().mockResolvedValue({})
  },
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))

const provider = new S3StorageProvider({
  type: 's3',
  bucket: 'b',
  region: 'us-east-1',
  pathPrefix: 'private',
})

const unsafe = ['../secret', 'a/b', '..', '.', '', 'a\\b', 'a\0b']

describe('S3StorageProvider key containment', () => {
  it.each(unsafe)('refuses %j on download, delete, getUrl and getSignedUrl', async (name) => {
    await expect(provider.download(name)).rejects.toThrow(/refused/)
    await expect(provider.delete(name)).rejects.toThrow(/refused/)
    expect(() => provider.getUrl(name)).toThrow(/refused/)
    await expect(provider.getSignedUrl(name)).rejects.toThrow(/refused/)
  })

  it('refuses an unsafe name on upload when unique filenames are off', async () => {
    const stable = new S3StorageProvider({
      type: 's3',
      bucket: 'b',
      region: 'us-east-1',
      generateUniqueFilenames: false,
    })
    await expect(stable.upload(Buffer.from('x'), '../evil.txt')).rejects.toThrow(/refused/)
  })

  it('accepts a plain filename', async () => {
    await expect(provider.delete('file.txt')).resolves.toBeUndefined()
    expect(provider.getUrl('file.txt')).toContain('private/file.txt')
  })
})
