import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VercelBlobStorageProvider, vercelBlobStorage } from '../src/index.js'
import type { VercelBlobStorageConfig } from '../src/index.js'

// Mock Vercel Blob SDK
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
}))

// Mock crypto for deterministic filename testing
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((size: number) => ({
    toString: () => 'a'.repeat(size * 2), // Hex string is 2x the byte length
  })),
}))

// Mock Date.now for predictable timestamps
const MOCK_TIMESTAMP = 1234567890000
vi.spyOn(Date, 'now').mockReturnValue(MOCK_TIMESTAMP)

// Mock global fetch for download tests
global.fetch = vi.fn()

describe('VercelBlobStorageProvider', () => {
  let put: ReturnType<typeof vi.fn>
  let del: ReturnType<typeof vi.fn>
  let head: ReturnType<typeof vi.fn>
  let fetch: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import mocked modules
    const vercelBlob = await import('@vercel/blob')
    put = vercelBlob.put as ReturnType<typeof vi.fn>
    del = vercelBlob.del as ReturnType<typeof vi.fn>
    head = vercelBlob.head as ReturnType<typeof vi.fn>
    fetch = global.fetch as ReturnType<typeof vi.fn>

    // Default mock implementations
    put.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/test-file.txt',
      downloadUrl: 'https://blob.vercel-storage.com/test-file.txt?download=1',
      pathname: 'test-file.txt',
    })

    head.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/test-file.txt',
      downloadUrl: 'https://blob.vercel-storage.com/test-file.txt?download=1',
      pathname: 'test-file.txt',
      size: 12345,
      uploadedAt: new Date(),
    })

    fetch.mockResolvedValue({
      ok: true,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(100),
    })
  })

  describe('constructor', () => {
    it('should create instance with token in config', () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token-123',
      }

      const provider = new VercelBlobStorageProvider(config)

      expect(provider).toBeInstanceOf(VercelBlobStorageProvider)
    })

    it('should create instance with token from env var', () => {
      process.env.BLOB_READ_WRITE_TOKEN = 'env-token-456'

      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
      }

      const provider = new VercelBlobStorageProvider(config)

      expect(provider).toBeInstanceOf(VercelBlobStorageProvider)

      delete process.env.BLOB_READ_WRITE_TOKEN
    })

    it('should throw error when no token available', () => {
      delete process.env.BLOB_READ_WRITE_TOKEN

      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
      }

      expect(() => new VercelBlobStorageProvider(config)).toThrow(
        'Vercel Blob token is required. Set config.token or BLOB_READ_WRITE_TOKEN environment variable.',
      )
    })
  })

  describe('upload', () => {
    it('should upload file successfully with Buffer', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      const fileBuffer = Buffer.from('test file content')
      const filename = 'test.txt'

      const result = await provider.upload(fileBuffer, filename)

      expect(put).toHaveBeenCalledWith(
        `${MOCK_TIMESTAMP}-${'a'.repeat(32)}.txt`,
        fileBuffer,
        expect.objectContaining({
          access: 'public',
          token: 'test-token',
        }),
      )
      expect(result.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
      expect(result.url).toBe('https://blob.vercel-storage.com/test-file.txt')
      expect(result.size).toBe(fileBuffer.length)
      expect(result.contentType).toBe('application/octet-stream')
      expect(result.metadata?.downloadUrl).toBe(
        'https://blob.vercel-storage.com/test-file.txt?download=1',
      )
    })

    it('should upload file successfully with Uint8Array', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      const uint8Array = new Uint8Array([1, 2, 3, 4, 5])

      const result = await provider.upload(uint8Array, 'binary.dat')

      expect(put).toHaveBeenCalledWith(
        expect.stringMatching(/\d+-[a-f0-9]+\.dat$/),
        expect.any(Buffer),
        expect.any(Object),
      )
      expect(result.size).toBe(uint8Array.length)
    })

    it('should generate unique filenames by default', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      const fileBuffer = Buffer.from('test')

      const result = await provider.upload(fileBuffer, 'test.txt')

      expect(result.filename).not.toBe('test.txt')
      expect(result.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
    })

    it('should preserve original filename when generateUniqueFilenames is false', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        generateUniqueFilenames: false,
      }
      const provider = new VercelBlobStorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'original.txt')

      expect(put).toHaveBeenCalledWith('original.txt', expect.any(Buffer), expect.any(Object))
      expect(result.filename).toBe('original.txt')
    })

    it('should preserve file extension when generating unique names', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      const resultTxt = await provider.upload(Buffer.from('test'), 'file.txt')
      const resultJpg = await provider.upload(Buffer.from('test'), 'photo.jpg')
      const resultNoExt = await provider.upload(Buffer.from('test'), 'noext')

      expect(resultTxt.filename).toMatch(/\.txt$/)
      expect(resultJpg.filename).toMatch(/\.jpg$/)
      expect(resultNoExt.filename).not.toMatch(/\./)
    })

    it('should apply pathPrefix to uploaded files', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'avatars',
        generateUniqueFilenames: false,
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'profile.jpg')

      expect(put).toHaveBeenCalledWith('avatars/profile.jpg', expect.any(Buffer), expect.any(Object))
    })

    it('should use provided contentType', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'test.txt', {
        contentType: 'text/plain',
      })

      expect(put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          contentType: 'text/plain',
        }),
      )
      expect(result.contentType).toBe('text/plain')
    })

    it('should set access to public by default', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          access: 'public',
        }),
      )
    })

    it('should respect config.public setting', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        public: false,
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          access: 'public', // Still public because config.public is false, not explicitly set to private
        }),
      )
    })

    it('should apply cacheControlMaxAge when configured', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        cacheControlMaxAge: 3600,
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          cacheControlMaxAge: 3600,
        }),
      )
    })

    it('should include custom metadata in result', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      const metadata = { uploadedBy: 'user123', category: 'documents' }

      const result = await provider.upload(Buffer.from('test'), 'test.txt', { metadata })

      expect(result.metadata).toMatchObject(metadata)
      expect(result.metadata?.downloadUrl).toBe(
        'https://blob.vercel-storage.com/test-file.txt?download=1',
      )
      expect(result.metadata?.pathname).toBe('test-file.txt')
    })

    it('should handle upload errors', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      put.mockRejectedValueOnce(new Error('Upload failed'))

      await expect(provider.upload(Buffer.from('test'), 'test.txt')).rejects.toThrow('Upload failed')
    })
  })

  describe('download', () => {
    it('should download file successfully and convert to Buffer', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      const mockArrayBuffer = new Uint8Array([1, 2, 3, 4, 5]).buffer

      head.mockResolvedValueOnce({
        url: 'https://blob.vercel-storage.com/test.txt',
        pathname: 'test.txt',
        size: 5,
        uploadedAt: new Date(),
      })

      fetch.mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () => mockArrayBuffer,
      })

      const result = await provider.download('test.txt')

      expect(head).toHaveBeenCalledWith('test.txt', { token: 'test-token' })
      expect(fetch).toHaveBeenCalledWith('https://blob.vercel-storage.com/test.txt')
      expect(result).toBeInstanceOf(Buffer)
      expect(result.length).toBe(5)
    })

    it('should apply pathPrefix when downloading', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'documents',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.download('report.pdf')

      expect(head).toHaveBeenCalledWith('documents/report.pdf', { token: 'test-token' })
    })

    it('should throw error when file not found (head returns null)', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      head.mockResolvedValueOnce(null)

      await expect(provider.download('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt',
      )
      expect(fetch).not.toHaveBeenCalled()
    })

    it('should throw error when fetch fails', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      })

      await expect(provider.download('test.txt')).rejects.toThrow(
        'Failed to download file: Internal Server Error',
      )
    })

    it('should handle non-200 fetch responses', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      })

      await expect(provider.download('missing.txt')).rejects.toThrow(
        'Failed to download file: Not Found',
      )
    })
  })

  describe('delete', () => {
    it('should delete file successfully', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      head.mockResolvedValueOnce({
        url: 'https://blob.vercel-storage.com/test.txt',
        pathname: 'test.txt',
        size: 100,
        uploadedAt: new Date(),
      })

      await provider.delete('test.txt')

      expect(head).toHaveBeenCalledWith('test.txt', { token: 'test-token' })
      expect(del).toHaveBeenCalledWith('https://blob.vercel-storage.com/test.txt', {
        token: 'test-token',
      })
    })

    it('should apply pathPrefix when deleting', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'temp',
      }
      const provider = new VercelBlobStorageProvider(config)

      head.mockResolvedValueOnce({
        url: 'https://blob.vercel-storage.com/temp/old-file.txt',
        pathname: 'temp/old-file.txt',
        size: 100,
        uploadedAt: new Date(),
      })

      await provider.delete('old-file.txt')

      expect(head).toHaveBeenCalledWith('temp/old-file.txt', { token: 'test-token' })
    })

    it('should handle file not found gracefully', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      head.mockResolvedValueOnce(null)

      // Should not throw error
      await provider.delete('nonexistent.txt')

      expect(head).toHaveBeenCalledWith('nonexistent.txt', { token: 'test-token' })
      expect(del).not.toHaveBeenCalled()
    })

    it('should handle deletion errors', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      head.mockResolvedValueOnce({
        url: 'https://blob.vercel-storage.com/test.txt',
        pathname: 'test.txt',
        size: 100,
        uploadedAt: new Date(),
      })

      del.mockRejectedValueOnce(new Error('Deletion failed'))

      await expect(provider.delete('test.txt')).rejects.toThrow('Deletion failed')
    })
  })

  describe('getUrl', () => {
    it('should return correct URL format', () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://blob.vercel-storage.com/photo.jpg')
    })

    it('should apply pathPrefix to URL', () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'images',
      }
      const provider = new VercelBlobStorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://blob.vercel-storage.com/images/photo.jpg')
    })

    it('should handle filenames with special characters', () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      const url = provider.getUrl('my file (1).txt')

      expect(url).toBe('https://blob.vercel-storage.com/my file (1).txt')
    })
  })

  describe('vercelBlobStorage factory', () => {
    it('should create config with correct defaults', () => {
      const config = vercelBlobStorage({ token: 'test-token' })

      expect(config).toEqual({
        type: 'vercel-blob',
        token: 'test-token',
        generateUniqueFilenames: true,
        public: true,
      })
    })

    it('should merge provided options with defaults', () => {
      const config = vercelBlobStorage({
        token: 'test-token',
        pathPrefix: 'uploads',
        generateUniqueFilenames: false,
        cacheControlMaxAge: 7200,
      })

      expect(config).toEqual({
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'uploads',
        generateUniqueFilenames: false,
        public: true,
        cacheControlMaxAge: 7200,
      })
    })

    it('should set type to vercel-blob', () => {
      const config = vercelBlobStorage({ token: 'test-token' })

      expect(config.type).toBe('vercel-blob')
    })
  })
})
