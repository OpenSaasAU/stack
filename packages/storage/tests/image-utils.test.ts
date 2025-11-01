import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getImageDimensions,
  transformImage,
  processImageTransformations,
} from '../src/utils/image.js'
import type { ImageTransformationConfig, StorageProvider } from '../src/config/types.js'

// Type for mocked sharp instances
interface MockSharpInstance {
  metadata?: ReturnType<typeof vi.fn>
  resize?: ReturnType<typeof vi.fn>
  jpeg?: ReturnType<typeof vi.fn>
  png?: ReturnType<typeof vi.fn>
  webp?: ReturnType<typeof vi.fn>
  avif?: ReturnType<typeof vi.fn>
  toBuffer?: ReturnType<typeof vi.fn>
}

// Mock sharp
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    avif: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('transformed-image-data')),
  }))

  return { default: mockSharp }
})

describe('Image Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getImageDimensions', () => {
    it('should return image dimensions from Buffer', async () => {
      const buffer = Buffer.from('fake-image-data')
      const { default: sharp } = await import('sharp')

      const dimensions = await getImageDimensions(buffer)

      expect(sharp).toHaveBeenCalledWith(buffer)
      expect(dimensions).toEqual({ width: 800, height: 600 })
    })

    it('should return image dimensions from Uint8Array', async () => {
      const uint8Array = new Uint8Array([1, 2, 3, 4])
      const { default: sharp } = await import('sharp')

      const dimensions = await getImageDimensions(uint8Array)

      expect(sharp).toHaveBeenCalledWith(uint8Array)
      expect(dimensions).toEqual({ width: 800, height: 600 })
    })

    it('should return 0 dimensions when metadata is missing', async () => {
      const { default: sharp } = await import('sharp')
      const mockInstance: MockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({}),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      const buffer = Buffer.from('fake-image-data')
      const dimensions = await getImageDimensions(buffer)

      expect(dimensions).toEqual({ width: 0, height: 0 })
    })
  })

  describe('transformImage', () => {
    it('should resize image with width and height', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        width: 400,
        height: 300,
      }

      const mockInstance: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      const result = await transformImage(buffer, transformation)

      expect(sharp).toHaveBeenCalledWith(buffer)
      expect(mockInstance.resize).toHaveBeenCalledWith({
        width: 400,
        height: 300,
        fit: 'cover',
      })
      expect(result).toBeInstanceOf(Buffer)
      expect(result.toString()).toBe('resized-image')
    })

    it('should resize with only width', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        width: 500,
      }

      const mockInstance: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.resize).toHaveBeenCalledWith({
        width: 500,
        height: undefined,
        fit: 'cover',
      })
    })

    it('should resize with custom fit option', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        width: 400,
        height: 300,
        fit: 'contain',
      }

      const mockInstance: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.resize).toHaveBeenCalledWith({
        width: 400,
        height: 300,
        fit: 'contain',
      })
    })

    it('should convert to JPEG format', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        format: 'jpeg',
      }

      const mockInstance: MockSharpInstance = {
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('jpeg-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.jpeg).toHaveBeenCalledWith({ quality: 80 })
    })

    it('should convert to PNG format', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        format: 'png',
      }

      const mockInstance: MockSharpInstance = {
        png: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('png-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.png).toHaveBeenCalledWith({ quality: 80 })
    })

    it('should convert to WebP format', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        format: 'webp',
      }

      const mockInstance: MockSharpInstance = {
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('webp-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.webp).toHaveBeenCalledWith({ quality: 80 })
    })

    it('should convert to AVIF format', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        format: 'avif',
      }

      const mockInstance: MockSharpInstance = {
        avif: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('avif-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.avif).toHaveBeenCalledWith({ quality: 80 })
    })

    it('should use custom quality setting', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        format: 'jpeg',
        quality: 95,
      }

      const mockInstance: MockSharpInstance = {
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('high-quality-jpeg')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      await transformImage(buffer, transformation)

      expect(mockInstance.jpeg).toHaveBeenCalledWith({ quality: 95 })
    })

    it('should combine resize and format conversion', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {
        width: 300,
        height: 200,
        format: 'webp',
        quality: 90,
      }

      const mockInstance: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-webp')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      const result = await transformImage(buffer, transformation)

      expect(mockInstance.resize).toHaveBeenCalledWith({
        width: 300,
        height: 200,
        fit: 'cover',
      })
      expect(mockInstance.webp).toHaveBeenCalledWith({ quality: 90 })
      expect(result.toString()).toBe('resized-webp')
    })

    it('should handle empty transformation config', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformation: ImageTransformationConfig = {}

      const mockInstance: MockSharpInstance = {
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('unchanged-image')),
      }
      vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)

      const result = await transformImage(buffer, transformation)

      expect(result.toString()).toBe('unchanged-image')
    })
  })

  describe('processImageTransformations', () => {
    it('should process multiple transformations', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const originalFilename = 'photo.jpg'
      const transformations: Record<string, ImageTransformationConfig> = {
        thumbnail: { width: 100, height: 100, format: 'webp' },
        medium: { width: 500, height: 500, format: 'jpeg' },
      }

      const mockProvider: StorageProvider = {
        upload: vi
          .fn()
          .mockResolvedValueOnce({
            filename: 'photo.jpg-thumbnail.webp',
            url: 'https://example.com/photo-thumbnail.webp',
            size: 5000,
          })
          .mockResolvedValueOnce({
            filename: 'photo.jpg-medium.jpeg',
            url: 'https://example.com/photo-medium.jpeg',
            size: 15000,
          }),
        download: vi.fn(),
        delete: vi.fn(),
        getUrl: vi.fn(),
      }

      // Mock sharp instances for each transformation
      const mockInstance1: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail-data')),
        metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
      }
      const mockInstance2: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('medium-data')),
        metadata: vi.fn().mockResolvedValue({ width: 500, height: 500 }),
      }
      const mockInstance3: MockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
      }
      const mockInstance4: MockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({ width: 500, height: 500 }),
      }

      vi.mocked(sharp)
        .mockReturnValueOnce(mockInstance1 as never)
        .mockReturnValueOnce(mockInstance3 as never)
        .mockReturnValueOnce(mockInstance2 as never)
        .mockReturnValueOnce(mockInstance4 as never)

      const results = await processImageTransformations(
        buffer,
        originalFilename,
        transformations,
        mockProvider,
        'image/jpeg',
      )

      expect(results).toEqual({
        thumbnail: {
          url: 'https://example.com/photo-thumbnail.webp',
          width: 100,
          height: 100,
          size: 5000,
        },
        medium: {
          url: 'https://example.com/photo-medium.jpeg',
          width: 500,
          height: 500,
          size: 15000,
        },
      })

      expect(mockProvider.upload).toHaveBeenCalledTimes(2)
      expect(mockProvider.upload).toHaveBeenNthCalledWith(
        1,
        expect.any(Buffer),
        'photo.jpg-thumbnail.webp',
        { contentType: 'image/webp' },
      )
      expect(mockProvider.upload).toHaveBeenNthCalledWith(
        2,
        expect.any(Buffer),
        'photo.jpg-medium.jpeg',
        { contentType: 'image/jpeg' },
      )
    })

    it('should handle transformation without format change', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformations: Record<string, ImageTransformationConfig> = {
        resized: { width: 300, height: 200 },
      }

      const mockProvider: StorageProvider = {
        upload: vi.fn().mockResolvedValue({
          filename: 'photo.jpg-resized',
          url: 'https://example.com/photo-resized',
          size: 10000,
        }),
        download: vi.fn(),
        delete: vi.fn(),
        getUrl: vi.fn(),
      }

      const mockInstance1: MockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-data')),
      }
      const mockInstance2: MockSharpInstance = {
        metadata: vi.fn().mockResolvedValue({ width: 300, height: 200 }),
      }

      vi.mocked(sharp)
        .mockReturnValueOnce(mockInstance1 as never)
        .mockReturnValueOnce(mockInstance2 as never)

      const results = await processImageTransformations(
        buffer,
        'photo.jpg',
        transformations,
        mockProvider,
        'image/jpeg',
      )

      expect(mockProvider.upload).toHaveBeenCalledWith(expect.any(Buffer), 'photo.jpg-resized', {
        contentType: 'image/jpeg',
      })
      expect(results.resized.width).toBe(300)
      expect(results.resized.height).toBe(200)
    })

    it('should process empty transformations object', async () => {
      const buffer = Buffer.from('original-image')
      const mockProvider: StorageProvider = {
        upload: vi.fn(),
        download: vi.fn(),
        delete: vi.fn(),
        getUrl: vi.fn(),
      }

      const results = await processImageTransformations(
        buffer,
        'photo.jpg',
        {},
        mockProvider,
        'image/jpeg',
      )

      expect(results).toEqual({})
      expect(mockProvider.upload).not.toHaveBeenCalled()
    })

    it('should append format extension when format is specified', async () => {
      const { default: sharp } = await import('sharp')
      const buffer = Buffer.from('original-image')
      const transformations: Record<string, ImageTransformationConfig> = {
        webp: { format: 'webp' },
        png: { format: 'png' },
        avif: { format: 'avif' },
      }

      const mockProvider: StorageProvider = {
        upload: vi
          .fn()
          .mockResolvedValueOnce({ filename: 'photo-webp.webp', url: 'url1', size: 1000 })
          .mockResolvedValueOnce({ filename: 'photo-png.png', url: 'url2', size: 2000 })
          .mockResolvedValueOnce({ filename: 'photo-avif.avif', url: 'url3', size: 3000 }),
        download: vi.fn(),
        delete: vi.fn(),
        getUrl: vi.fn(),
      }

      // Mock multiple sharp instances
      for (let i = 0; i < 6; i++) {
        const mockInstance: MockSharpInstance = {
          webp: vi.fn().mockReturnThis(),
          png: vi.fn().mockReturnThis(),
          avif: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockResolvedValue(Buffer.from('data')),
          metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
        }
        vi.mocked(sharp).mockReturnValueOnce(mockInstance as never)
      }

      await processImageTransformations(
        buffer,
        'photo',
        transformations,
        mockProvider,
        'image/jpeg',
      )

      expect(mockProvider.upload).toHaveBeenNthCalledWith(
        1,
        expect.any(Buffer),
        'photo-webp.webp',
        { contentType: 'image/webp' },
      )
      expect(mockProvider.upload).toHaveBeenNthCalledWith(2, expect.any(Buffer), 'photo-png.png', {
        contentType: 'image/png',
      })
      expect(mockProvider.upload).toHaveBeenNthCalledWith(
        3,
        expect.any(Buffer),
        'photo-avif.avif',
        { contentType: 'image/avif' },
      )
    })
  })
})
