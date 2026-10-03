import { describe, it, expect, vi } from 'vitest'
import { VercelBlobStorageProvider } from '../src/index.js'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  BlobNotFoundError: class extends Error {},
}))

const provider = new VercelBlobStorageProvider({
  type: 'vercel-blob',
  token: 'vercel_blob_rw_store1_secret',
  pathPrefix: 'private',
})

const unsafe = ['../secret', 'a/b', '..', '.', '', 'a\\b', 'a\0b']

describe('VercelBlobStorageProvider pathname containment', () => {
  it.each(unsafe)('refuses %j on download, delete, getUrl and getSignedUrl', async (name) => {
    await expect(provider.download(name)).rejects.toThrow(/refused/)
    await expect(provider.delete(name)).rejects.toThrow(/refused/)
    expect(() => provider.getUrl(name)).toThrow(/refused/)
    await expect(provider.getSignedUrl(name)).rejects.toThrow(/refused/)
  })

  it('refuses an unsafe name on upload when unique filenames are off', async () => {
    const stable = new VercelBlobStorageProvider({
      type: 'vercel-blob',
      token: 'vercel_blob_rw_store1_secret',
      generateUniqueFilenames: false,
    })
    await expect(stable.upload(Buffer.from('x'), '../evil.txt')).rejects.toThrow(/refused/)
  })

  it('accepts a plain filename', async () => {
    await expect(provider.delete('file.txt')).resolves.toBeUndefined()
    expect(provider.getUrl('file.txt')).toContain('private/file.txt')
  })
})
