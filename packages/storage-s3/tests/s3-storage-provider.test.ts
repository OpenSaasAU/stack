import { describe, it, expect, vi, beforeEach } from 'vitest'
import { S3StorageProvider, s3Storage } from '../src/index.js'
import type { S3StorageConfig } from '../src/index.js'

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn()
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

// Mock crypto for deterministic filename testing
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((size: number) => ({
    toString: () => 'a'.repeat(size * 2), // Hex string is 2x the byte length
  })),
}))

// Mock Date.now for predictable timestamps
const MOCK_TIMESTAMP = 1234567890000
vi.spyOn(Date, 'now').mockReturnValue(MOCK_TIMESTAMP)

describe('S3StorageProvider', () => {
  let PutObjectCommand: ReturnType<typeof vi.fn>
  let GetObjectCommand: ReturnType<typeof vi.fn>
  let DeleteObjectCommand: ReturnType<typeof vi.fn>
  let getSignedUrl: ReturnType<typeof vi.fn>
  let mockSend: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import mocked modules
    const s3Module = await import('@aws-sdk/client-s3')
    const presignerModule = await import('@aws-sdk/s3-request-presigner')

    PutObjectCommand = s3Module.PutObjectCommand as unknown as ReturnType<typeof vi.fn>
    GetObjectCommand = s3Module.GetObjectCommand as unknown as ReturnType<typeof vi.fn>
    DeleteObjectCommand = s3Module.DeleteObjectCommand as unknown as ReturnType<typeof vi.fn>
    getSignedUrl = presignerModule.getSignedUrl as ReturnType<typeof vi.fn>

    // Get the shared mockSend function
    const S3ClientClass = s3Module.S3Client as any
    mockSend = new S3ClientClass().send

    // Default mock implementations
    mockSend.mockResolvedValue({})
    getSignedUrl.mockResolvedValue('https://signed-url.example.com')
  })

  describe('constructor', () => {
    it('should create instance with accessKeyId and secretAccessKey', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }

      const provider = new S3StorageProvider(config)

      expect(provider).toBeInstanceOf(S3StorageProvider)
    })

    it('should create instance without credentials (IAM role)', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-west-2',
      }

      const provider = new S3StorageProvider(config)

      expect(provider).toBeInstanceOf(S3StorageProvider)
    })

    it('should create instance with custom endpoint for S3-compatible services', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        endpoint: 'https://minio.example.com',
        forcePathStyle: true,
      }

      const provider = new S3StorageProvider(config)

      expect(provider).toBeInstanceOf(S3StorageProvider)
    })

    it('should create instance with forcePathStyle option', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        forcePathStyle: true,
      }

      const provider = new S3StorageProvider(config)

      expect(provider).toBeInstanceOf(S3StorageProvider)
    })
  })

  describe('upload', () => {
    it('should upload file successfully with Buffer', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)
      const fileBuffer = Buffer.from('test file content')

      const result = await provider.upload(fileBuffer, 'test.txt')

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: `${MOCK_TIMESTAMP}-${'a'.repeat(32)}.txt`,
        Body: fileBuffer,
        ContentType: undefined,
        Metadata: undefined,
        ACL: 'private',
        CacheControl: undefined,
      })
      expect(mockSend).toHaveBeenCalled()
      expect(result.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
      expect(result.url).toBe(
        `https://test-bucket.s3.us-east-1.amazonaws.com/${MOCK_TIMESTAMP}-${'a'.repeat(32)}.txt`,
      )
      expect(result.size).toBe(fileBuffer.length)
      expect(result.contentType).toBe('application/octet-stream')
    })

    it('should upload file successfully with Uint8Array', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)
      const uint8Array = new Uint8Array([1, 2, 3, 4, 5])

      const result = await provider.upload(uint8Array, 'binary.dat')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Body: uint8Array,
        }),
      )
      expect(result.size).toBe(uint8Array.length)
    })

    it('should generate unique filenames by default', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'test.txt')

      expect(result.filename).not.toBe('test.txt')
      expect(result.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
    })

    it('should preserve original filename when generateUniqueFilenames is false', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        generateUniqueFilenames: false,
      }
      const provider = new S3StorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'original.txt')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'original.txt',
        }),
      )
      expect(result.filename).toBe('original.txt')
    })

    it('should preserve file extension when generating unique names', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      const resultTxt = await provider.upload(Buffer.from('test'), 'file.txt')
      const resultJpg = await provider.upload(Buffer.from('test'), 'photo.jpg')
      const resultNoExt = await provider.upload(Buffer.from('test'), 'noext')

      expect(resultTxt.filename).toMatch(/\.txt$/)
      expect(resultJpg.filename).toMatch(/\.jpg$/)
      expect(resultNoExt.filename).not.toMatch(/\./)
    })

    it('should apply pathPrefix to uploaded files', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        pathPrefix: 'avatars',
        generateUniqueFilenames: false,
      }
      const provider = new S3StorageProvider(config)

      await provider.upload(Buffer.from('test'), 'profile.jpg')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'avatars/profile.jpg',
        }),
      )
    })

    it('should use provided contentType', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'test.txt', {
        contentType: 'text/plain',
      })

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'text/plain',
        }),
      )
      expect(result.contentType).toBe('text/plain')
    })

    it('should use provided metadata', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)
      const metadata = { uploadedBy: 'user123', category: 'documents' }

      const result = await provider.upload(Buffer.from('test'), 'test.txt', { metadata })

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Metadata: metadata,
        }),
      )
      expect(result.metadata).toEqual(metadata)
    })

    it('should apply ACL setting - private (default)', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ACL: 'private',
        }),
      )
    })

    it('should apply ACL setting - public-read', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        acl: 'public-read',
      }
      const provider = new S3StorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ACL: 'public-read',
        }),
      )
    })

    it('should apply cacheControl header', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt', {
        cacheControl: 'public, max-age=31536000',
      })

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          CacheControl: 'public, max-age=31536000',
        }),
      )
    })

    it('should handle upload errors', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)
      mockSend.mockRejectedValueOnce(new Error('Upload failed'))

      await expect(provider.upload(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        'Upload failed',
      )
    })
  })

  describe('download', () => {
    it('should download file successfully and convert stream to Buffer', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      // Mock async iterable stream
      const mockChunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          for (const chunk of mockChunks) {
            yield chunk
          }
        },
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
      })

      const result = await provider.download('test.txt')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.txt',
      })
      expect(mockSend).toHaveBeenCalled()
      expect(result).toBeInstanceOf(Buffer)
      expect(result).toEqual(Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from([4, 5])]))
    })

    it('should apply pathPrefix when downloading', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        pathPrefix: 'documents',
      }
      const provider = new S3StorageProvider(config)

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2, 3])
        },
      }

      mockSend.mockResolvedValueOnce({
        Body: mockStream,
      })

      await provider.download('report.pdf')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'documents/report.pdf',
      })
    })

    it('should throw error when file not found (empty body)', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      mockSend.mockResolvedValueOnce({
        Body: null,
      })

      await expect(provider.download('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt',
      )
    })

    it('should throw error when file not found (undefined body)', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      mockSend.mockResolvedValueOnce({})

      await expect(provider.download('nonexistent.txt')).rejects.toThrow(
        'File not found: nonexistent.txt',
      )
    })

    it('should handle stream reading errors', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      mockSend.mockRejectedValueOnce(new Error('Network error'))

      await expect(provider.download('test.txt')).rejects.toThrow('Network error')
    })
  })

  describe('delete', () => {
    it('should delete file successfully', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      await provider.delete('test.txt')

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.txt',
      })
      expect(mockSend).toHaveBeenCalled()
    })

    it('should apply pathPrefix when deleting', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        pathPrefix: 'temp',
      }
      const provider = new S3StorageProvider(config)

      await provider.delete('old-file.txt')

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'temp/old-file.txt',
      })
    })

    it('should handle deletion errors', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      mockSend.mockRejectedValueOnce(new Error('Deletion failed'))

      await expect(provider.delete('test.txt')).rejects.toThrow('Deletion failed')
    })

    it('should not throw on non-existent file deletion', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      // S3 DeleteObject succeeds even if file doesn't exist
      mockSend.mockResolvedValueOnce({})

      await expect(provider.delete('nonexistent.txt')).resolves.not.toThrow()
    })
  })

  describe('getUrl', () => {
    it('should return standard AWS S3 URL format', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/photo.jpg')
    })

    it('should apply pathPrefix to URL', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-west-2',
        pathPrefix: 'images',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://my-bucket.s3.us-west-2.amazonaws.com/images/photo.jpg')
    })

    it('should use customDomain when configured', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        customDomain: 'https://cdn.example.com',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://cdn.example.com/photo.jpg')
    })

    it('should use customDomain with pathPrefix', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        customDomain: 'https://cdn.example.com',
        pathPrefix: 'assets',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('https://cdn.example.com/assets/photo.jpg')
    })

    it('should use custom endpoint for S3-compatible services', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        endpoint: 'https://minio.example.com',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('file.pdf')

      expect(url).toBe('https://minio.example.com/my-bucket/file.pdf')
    })

    it('should handle forcePathStyle URL format with custom endpoint', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.backblazeb2.com',
        forcePathStyle: true,
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('file.pdf')

      expect(url).toBe('https://s3.backblazeb2.com/my-bucket/file.pdf')
    })

    it('should handle filenames with special characters', () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      const url = provider.getUrl('my file (1).txt')

      expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/my file (1).txt')
    })
  })

  describe('getSignedUrl', () => {
    it('should generate signed URL with default expiration', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      getSignedUrl.mockResolvedValueOnce('https://signed.example.com/test.txt?signature=abc123')

      const url = await provider.getSignedUrl('test.txt')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test.txt',
      })
      expect(getSignedUrl).toHaveBeenCalledWith(expect.any(Object), expect.anything(), {
        expiresIn: 3600,
      })
      expect(url).toBe('https://signed.example.com/test.txt?signature=abc123')
    })

    it('should generate signed URL with custom expiration', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      await provider.getSignedUrl('test.txt', 7200)

      expect(getSignedUrl).toHaveBeenCalledWith(expect.any(Object), expect.anything(), {
        expiresIn: 7200,
      })
    })

    it('should apply pathPrefix to signed URLs', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        pathPrefix: 'private',
      }
      const provider = new S3StorageProvider(config)

      await provider.getSignedUrl('document.pdf')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'private/document.pdf',
      })
    })

    it('should handle signing errors', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      getSignedUrl.mockRejectedValueOnce(new Error('Signing failed'))

      await expect(provider.getSignedUrl('test.txt')).rejects.toThrow('Signing failed')
    })

    it('should generate different signed URLs for different files', async () => {
      const config: S3StorageConfig = {
        type: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
      }
      const provider = new S3StorageProvider(config)

      getSignedUrl
        .mockResolvedValueOnce('https://signed.example.com/file1.txt?sig=abc')
        .mockResolvedValueOnce('https://signed.example.com/file2.txt?sig=def')

      const url1 = await provider.getSignedUrl('file1.txt')
      const url2 = await provider.getSignedUrl('file2.txt')

      expect(url1).not.toBe(url2)
      expect(GetObjectCommand).toHaveBeenCalledTimes(2)
    })
  })

  describe('s3Storage factory', () => {
    it('should create config with correct defaults', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
      })

      expect(config).toEqual({
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        generateUniqueFilenames: true,
        acl: 'private',
      })
    })

    it('should merge provided options with defaults', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-west-2',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        pathPrefix: 'uploads',
        generateUniqueFilenames: false,
      })

      expect(config).toEqual({
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-west-2',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        pathPrefix: 'uploads',
        generateUniqueFilenames: false,
        acl: 'private',
      })
    })

    it('should set type to s3', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
      })

      expect(config.type).toBe('s3')
    })

    it('should override default ACL', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
        acl: 'public-read',
      })

      expect(config.acl).toBe('public-read')
    })

    it('should support custom endpoint configuration', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
        endpoint: 'https://minio.example.com',
        forcePathStyle: true,
      })

      expect(config.endpoint).toBe('https://minio.example.com')
      expect(config.forcePathStyle).toBe(true)
    })

    it('should support customDomain configuration', () => {
      const config = s3Storage({
        bucket: 'my-bucket',
        region: 'us-east-1',
        customDomain: 'https://cdn.example.com',
      })

      expect(config.customDomain).toBe('https://cdn.example.com')
    })
  })
})
