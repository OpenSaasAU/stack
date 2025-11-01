import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalStorageProvider } from '../src/providers/local.js'
import type { LocalStorageConfig } from '../src/config/types.js'

// Mock Node.js filesystem modules
vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
  },
}))

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((size: number) => ({
    toString: () => 'a'.repeat(size * 2), // Hex string is 2x the byte length
  })),
}))

describe('LocalStorageProvider', () => {
  let fs: any
  let crypto: any

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = (await import('node:fs/promises')).default
    crypto = await import('node:crypto')

    // Default mock implementations
    fs.access.mockResolvedValue(undefined)
    fs.mkdir.mockResolvedValue(undefined)
    fs.writeFile.mockResolvedValue(undefined)
    fs.readFile.mockResolvedValue(Buffer.from('file-contents'))
    fs.unlink.mockResolvedValue(undefined)
    fs.stat.mockResolvedValue({ size: 12345 })
  })

  describe('constructor', () => {
    it('should create instance with config', () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }

      const provider = new LocalStorageProvider(config)

      expect(provider).toBeInstanceOf(LocalStorageProvider)
    })
  })

  describe('upload', () => {
    it('should upload file successfully', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      const fileBuffer = Buffer.from('test file content')
      const filename = 'test.txt'

      const result = await provider.upload(fileBuffer, filename)

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/uploads\/\d+-.*\.txt$/),
        fileBuffer,
      )
      expect(result.url).toMatch(/\/uploads\/\d+-.*\.txt/)
      expect(result.size).toBe(12345)
      expect(result.contentType).toBe('application/octet-stream')
    })

    it('should create upload directory if it does not exist', async () => {
      fs.access.mockRejectedValueOnce(new Error('Directory does not exist'))

      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './new-uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(fs.mkdir).toHaveBeenCalledWith('./new-uploads', { recursive: true })
    })

    it('should not create directory if it already exists', async () => {
      fs.access.mockResolvedValueOnce(undefined)

      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './existing-uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(fs.mkdir).not.toHaveBeenCalled()
    })

    it('should generate unique filenames by default', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      const result1 = await provider.upload(Buffer.from('test1'), 'test.txt')
      const result2 = await provider.upload(Buffer.from('test2'), 'test.txt')

      expect(result1.filename).not.toBe('test.txt')
      expect(result2.filename).not.toBe('test.txt')
      expect(result1.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
      expect(result2.filename).toMatch(/\d+-[a-f0-9]+\.txt/)
    })

    it('should preserve original filename when generateUniqueFilenames is false', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
        generateUniqueFilenames: false,
      }
      const provider = new LocalStorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'original.txt')

      expect(result.filename).toBe('original.txt')
      expect(result.url).toBe('/uploads/original.txt')
    })

    it('should preserve file extension when generating unique names', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      const resultTxt = await provider.upload(Buffer.from('test'), 'file.txt')
      const resultJpg = await provider.upload(Buffer.from('test'), 'photo.jpg')
      const resultNoExt = await provider.upload(Buffer.from('test'), 'noext')

      expect(resultTxt.filename).toMatch(/\.txt$/)
      expect(resultJpg.filename).toMatch(/\.jpg$/)
      expect(resultNoExt.filename).not.toMatch(/\./)
    })

    it('should use provided content type', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      const result = await provider.upload(
        Buffer.from('test'),
        'test.txt',
        { contentType: 'text/plain' },
      )

      expect(result.contentType).toBe('text/plain')
    })

    it('should store custom metadata', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      const metadata = { uploadedBy: 'user123', category: 'documents' }

      const result = await provider.upload(
        Buffer.from('test'),
        'test.txt',
        { metadata },
      )

      expect(result.metadata).toEqual(metadata)
    })

    it('should handle Uint8Array input', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      const uint8Array = new Uint8Array([1, 2, 3, 4, 5])

      await provider.upload(uint8Array, 'binary.dat')

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        uint8Array,
      )
    })

    it('should construct correct file path', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './my-uploads',
        serveUrl: '/files',
        generateUniqueFilenames: false,
      }
      const provider = new LocalStorageProvider(config)

      await provider.upload(Buffer.from('test'), 'test.txt')

      expect(fs.writeFile).toHaveBeenCalledWith(
        'my-uploads/test.txt',
        expect.any(Buffer),
      )
    })

    it('should return correct URL', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: 'https://example.com/files',
        generateUniqueFilenames: false,
      }
      const provider = new LocalStorageProvider(config)

      const result = await provider.upload(Buffer.from('test'), 'photo.jpg')

      expect(result.url).toBe('https://example.com/files/photo.jpg')
    })
  })

  describe('download', () => {
    it('should download file successfully', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      const expectedBuffer = Buffer.from('downloaded file content')
      fs.readFile.mockResolvedValueOnce(expectedBuffer)

      const result = await provider.download('test-file.txt')

      expect(fs.readFile).toHaveBeenCalledWith('uploads/test-file.txt')
      expect(result).toBe(expectedBuffer)
    })

    it('should construct correct file path for download', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './my-storage',
        serveUrl: '/files',
      }
      const provider = new LocalStorageProvider(config)

      await provider.download('document.pdf')

      expect(fs.readFile).toHaveBeenCalledWith('my-storage/document.pdf')
    })

    it('should propagate filesystem errors', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      fs.readFile.mockRejectedValueOnce(new Error('File not found'))

      await expect(provider.download('nonexistent.txt')).rejects.toThrow('File not found')
    })
  })

  describe('delete', () => {
    it('should delete file successfully', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      await provider.delete('file-to-delete.txt')

      expect(fs.unlink).toHaveBeenCalledWith('uploads/file-to-delete.txt')
    })

    it('should construct correct file path for deletion', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './my-storage/files',
        serveUrl: '/files',
      }
      const provider = new LocalStorageProvider(config)

      await provider.delete('old-file.jpg')

      expect(fs.unlink).toHaveBeenCalledWith('my-storage/files/old-file.jpg')
    })

    it('should propagate filesystem errors on delete', async () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)
      fs.unlink.mockRejectedValueOnce(new Error('Permission denied'))

      await expect(provider.delete('protected.txt')).rejects.toThrow('Permission denied')
    })
  })

  describe('getUrl', () => {
    it('should return correct URL for filename', () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      const url = provider.getUrl('photo.jpg')

      expect(url).toBe('/uploads/photo.jpg')
    })

    it('should work with custom serve URL', () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './storage',
        serveUrl: 'https://cdn.example.com/files',
      }
      const provider = new LocalStorageProvider(config)

      const url = provider.getUrl('document.pdf')

      expect(url).toBe('https://cdn.example.com/files/document.pdf')
    })

    it('should handle filenames with special characters', () => {
      const config: LocalStorageConfig = {
        type: 'local',
        uploadDir: './uploads',
        serveUrl: '/uploads',
      }
      const provider = new LocalStorageProvider(config)

      const url = provider.getUrl('my file (1).txt')

      expect(url).toBe('/uploads/my file (1).txt')
    })
  })
})
