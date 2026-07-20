import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VercelBlobStorageProvider, vercelBlobStorage } from '../src/index.js'
import type { VercelBlobStorageConfig } from '../src/index.js'

// Mirrors @vercel/blob's real BlobNotFoundError shape (extends BlobError)
const { BlobNotFoundError } = vi.hoisted(() => {
  class BlobNotFoundError extends Error {
    constructor() {
      super('The requested blob does not exist')
      this.name = 'BlobNotFoundError'
    }
  }
  return { BlobNotFoundError }
})

// Mock Vercel Blob SDK
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
  get: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  BlobNotFoundError,
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

function createReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('VercelBlobStorageProvider', () => {
  let put: ReturnType<typeof vi.fn>
  let del: ReturnType<typeof vi.fn>
  let head: ReturnType<typeof vi.fn>
  let get: ReturnType<typeof vi.fn>
  let issueSignedToken: ReturnType<typeof vi.fn>
  let presignUrl: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import mocked modules
    const vercelBlob = await import('@vercel/blob')
    put = vercelBlob.put as ReturnType<typeof vi.fn>
    del = vercelBlob.del as ReturnType<typeof vi.fn>
    head = vercelBlob.head as ReturnType<typeof vi.fn>
    get = vercelBlob.get as ReturnType<typeof vi.fn>
    issueSignedToken = vercelBlob.issueSignedToken as ReturnType<typeof vi.fn>
    presignUrl = vercelBlob.presignUrl as ReturnType<typeof vi.fn>

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

    get.mockResolvedValue({
      statusCode: 200,
      stream: createReadableStream(new Uint8Array([1, 2, 3, 4, 5])),
      headers: new Headers(),
      blob: {
        url: 'https://blob.vercel-storage.com/test-file.txt',
        downloadUrl: 'https://blob.vercel-storage.com/test-file.txt?download=1',
        pathname: 'test-file.txt',
        contentDisposition: '',
        cacheControl: '',
        uploadedAt: new Date(),
        etag: 'etag',
        contentType: 'text/plain',
        size: 5,
      },
    })

    issueSignedToken.mockResolvedValue({
      delegationToken: 'delegation-token',
      clientSigningToken: 'client-signing-token',
      validUntil: MOCK_TIMESTAMP + 3600_000,
    })

    presignUrl.mockResolvedValue({
      presignedUrl: 'https://blob.vercel-storage.com/test-file.txt?signature=abc',
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

      expect(put).toHaveBeenCalledWith(
        'avatars/profile.jpg',
        expect.any(Buffer),
        expect.any(Object),
      )
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

    it('should set access to private when config.public is false', async () => {
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
          access: 'private',
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

      await expect(provider.upload(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        'Upload failed',
      )
    })
  })

  describe('download', () => {
    it('should download a public file successfully and convert to Buffer', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      get.mockResolvedValueOnce({
        statusCode: 200,
        stream: createReadableStream(new Uint8Array([1, 2, 3, 4, 5])),
        headers: new Headers(),
        blob: {
          url: 'https://blob.vercel-storage.com/test.txt',
          downloadUrl: 'https://blob.vercel-storage.com/test.txt?download=1',
          pathname: 'test.txt',
          contentDisposition: '',
          cacheControl: '',
          uploadedAt: new Date(),
          etag: 'etag',
          contentType: 'text/plain',
          size: 5,
        },
      })

      const result = await provider.download('test.txt')

      expect(get).toHaveBeenCalledWith('test.txt', { access: 'public', token: 'test-token' })
      expect(result).toBeInstanceOf(Buffer)
      expect(result.length).toBe(5)
      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
    })

    it('should download a private file using private access', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        public: false,
      }
      const provider = new VercelBlobStorageProvider(config)

      const result = await provider.download('secret.pdf')

      expect(get).toHaveBeenCalledWith('secret.pdf', { access: 'private', token: 'test-token' })
      expect(result).toBeInstanceOf(Buffer)
    })

    it('should apply pathPrefix when downloading', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'documents',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.download('report.pdf')

      expect(get).toHaveBeenCalledWith('documents/report.pdf', {
        access: 'public',
        token: 'test-token',
      })
    })

    it('should throw a descriptive error when the file is not found (get resolves null)', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      get.mockResolvedValueOnce(null)

      await expect(provider.download('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt',
      )
    })

    it('should propagate non-not-found errors from get', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      get.mockRejectedValueOnce(new Error('Network error'))

      await expect(provider.download('test.txt')).rejects.toThrow('Network error')
    })
  })

  describe('delete', () => {
    it('should delete file successfully by pathname, without a head() round-trip', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.delete('test.txt')

      expect(head).not.toHaveBeenCalled()
      expect(del).toHaveBeenCalledWith('test.txt', {
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

      await provider.delete('old-file.txt')

      expect(del).toHaveBeenCalledWith('temp/old-file.txt', { token: 'test-token' })
    })

    it('should resolve without error when deleting a nonexistent pathname (idempotent)', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)
      del.mockRejectedValueOnce(new BlobNotFoundError())

      await expect(provider.delete('nonexistent.txt')).resolves.toBeUndefined()
    })

    it('should propagate non-not-found deletion errors', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

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

  describe('getSignedUrl', () => {
    it('should issue a signed token and return a presigned URL for a private file', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        public: false,
      }
      const provider = new VercelBlobStorageProvider(config)

      const url = await provider.getSignedUrl('secret.pdf', 1800)

      expect(issueSignedToken).toHaveBeenCalledWith({
        pathname: 'secret.pdf',
        operations: ['get'],
        validUntil: MOCK_TIMESTAMP + 1800_000,
        token: 'test-token',
      })
      expect(presignUrl).toHaveBeenCalledWith(
        {
          delegationToken: 'delegation-token',
          clientSigningToken: 'client-signing-token',
        },
        {
          operation: 'get',
          pathname: 'secret.pdf',
          validUntil: MOCK_TIMESTAMP + 1800_000,
          access: 'private',
        },
      )
      expect(url).toBe('https://blob.vercel-storage.com/test-file.txt?signature=abc')
    })

    it('should default to a 1 hour expiry', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.getSignedUrl('report.pdf')

      expect(issueSignedToken).toHaveBeenCalledWith(
        expect.objectContaining({ validUntil: MOCK_TIMESTAMP + 3600_000 }),
      )
    })

    it('should use public access for a public file', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.getSignedUrl('photo.jpg')

      expect(presignUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ access: 'public' }),
      )
    })

    it('should apply pathPrefix to the signed pathname', async () => {
      const config: VercelBlobStorageConfig = {
        type: 'vercel-blob',
        token: 'test-token',
        pathPrefix: 'documents',
      }
      const provider = new VercelBlobStorageProvider(config)

      await provider.getSignedUrl('report.pdf')

      expect(issueSignedToken).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: 'documents/report.pdf' }),
      )
      expect(presignUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ pathname: 'documents/report.pdf' }),
      )
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
