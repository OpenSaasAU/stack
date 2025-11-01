import { describe, it, expect } from 'vitest'
import {
  validateFile,
  formatFileSize,
  getMimeType,
  fileToBuffer,
  parseFileFromFormData,
  type FileValidationOptions,
} from '../src/utils/upload.js'

describe('Upload Utilities', () => {
  describe('validateFile', () => {
    it('should return valid when no options provided', () => {
      const file = { size: 1000, name: 'test.txt', type: 'text/plain' }
      const result = validateFile(file)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return valid when options are empty', () => {
      const file = { size: 1000, name: 'test.txt', type: 'text/plain' }
      const result = validateFile(file, {})
      expect(result.valid).toBe(true)
    })

    describe('file size validation', () => {
      it('should accept files within size limit', () => {
        const file = { size: 1000, name: 'test.txt', type: 'text/plain' }
        const options: FileValidationOptions = { maxFileSize: 2000 }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should reject files exceeding size limit', () => {
        const file = { size: 3000, name: 'test.txt', type: 'text/plain' }
        const options: FileValidationOptions = { maxFileSize: 2000 }
        const result = validateFile(file, options)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('File size exceeds maximum')
        expect(result.error).toContain('1.95 KB')
      })

      it('should accept files exactly at size limit', () => {
        const file = { size: 2000, name: 'test.txt', type: 'text/plain' }
        const options: FileValidationOptions = { maxFileSize: 2000 }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })
    })

    describe('MIME type validation', () => {
      it('should accept files with allowed MIME type', () => {
        const file = { size: 1000, name: 'test.jpg', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          acceptedMimeTypes: ['image/jpeg', 'image/png'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should reject files with disallowed MIME type', () => {
        const file = { size: 1000, name: 'test.gif', type: 'image/gif' }
        const options: FileValidationOptions = {
          acceptedMimeTypes: ['image/jpeg', 'image/png'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('File type')
        expect(result.error).toContain('image/gif')
        expect(result.error).toContain('image/jpeg')
      })

      it('should fall back to filename extension when type is empty', () => {
        const file = { size: 1000, name: 'test.jpg', type: '' }
        const options: FileValidationOptions = {
          acceptedMimeTypes: ['image/jpeg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should reject unknown MIME types when restrictions exist', () => {
        const file = { size: 1000, name: 'test.xyz', type: '' }
        const options: FileValidationOptions = {
          acceptedMimeTypes: ['image/jpeg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(false)
      })
    })

    describe('file extension validation', () => {
      it('should accept files with allowed extension', () => {
        const file = { size: 1000, name: 'test.jpg', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          acceptedExtensions: ['.jpg', '.png'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should reject files with disallowed extension', () => {
        const file = { size: 1000, name: 'test.gif', type: 'image/gif' }
        const options: FileValidationOptions = {
          acceptedExtensions: ['.jpg', '.png'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('File extension')
        expect(result.error).toContain('.gif')
      })

      it('should handle case-insensitive extensions', () => {
        const file = { size: 1000, name: 'test.JPG', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          acceptedExtensions: ['.jpg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should handle files with multiple dots in name', () => {
        const file = { size: 1000, name: 'my.test.file.jpg', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          acceptedExtensions: ['.jpg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })
    })

    describe('combined validation', () => {
      it('should validate all criteria when multiple options provided', () => {
        const file = { size: 1000, name: 'test.jpg', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          maxFileSize: 2000,
          acceptedMimeTypes: ['image/jpeg'],
          acceptedExtensions: ['.jpg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(true)
      })

      it('should fail if any criterion is not met', () => {
        const file = { size: 3000, name: 'test.jpg', type: 'image/jpeg' }
        const options: FileValidationOptions = {
          maxFileSize: 2000,
          acceptedMimeTypes: ['image/jpeg'],
          acceptedExtensions: ['.jpg'],
        }
        const result = validateFile(file, options)
        expect(result.valid).toBe(false)
      })
    })
  })

  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 Bytes')
    })

    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 Bytes')
      expect(formatFileSize(1023)).toBe('1023 Bytes')
    })

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB')
      expect(formatFileSize(2048)).toBe('2 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
    })

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB')
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    })

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
      expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
    })

    it('should round to 2 decimal places', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(1555)).toBe('1.52 KB')
      expect(formatFileSize(1666)).toBe('1.63 KB')
    })
  })

  describe('getMimeType', () => {
    it('should return correct MIME type for common extensions', () => {
      expect(getMimeType('test.jpg')).toBe('image/jpeg')
      expect(getMimeType('test.jpeg')).toBe('image/jpeg')
      expect(getMimeType('test.png')).toBe('image/png')
      expect(getMimeType('test.gif')).toBe('image/gif')
      expect(getMimeType('test.pdf')).toBe('application/pdf')
      expect(getMimeType('test.txt')).toBe('text/plain')
      expect(getMimeType('test.html')).toBe('text/html')
      expect(getMimeType('test.json')).toBe('application/json')
    })

    it('should handle uppercase extensions', () => {
      expect(getMimeType('test.JPG')).toBe('image/jpeg')
      expect(getMimeType('test.PNG')).toBe('image/png')
    })

    it('should return default MIME type for unknown extensions', () => {
      // Note: .xyz is recognized by mime-types as 'chemical/x-xyz'
      // Using a truly unknown extension instead
      expect(getMimeType('test.unknownext')).toBe('application/octet-stream')
      expect(getMimeType('noextension')).toBe('application/octet-stream')
    })

    it('should handle files with multiple dots', () => {
      expect(getMimeType('my.test.file.jpg')).toBe('image/jpeg')
    })
  })

  describe('fileToBuffer', () => {
    it('should convert File to Buffer', async () => {
      // Create a mock File object
      const content = 'test file content'
      const blob = new Blob([content], { type: 'text/plain' })
      const file = new File([blob], 'test.txt', { type: 'text/plain' })

      const buffer = await fileToBuffer(file)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString()).toBe(content)
    })

    it('should convert Blob to Buffer', async () => {
      const content = 'test blob content'
      const blob = new Blob([content], { type: 'text/plain' })

      const buffer = await fileToBuffer(blob)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString()).toBe(content)
    })

    it('should handle binary data', async () => {
      const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const blob = new Blob([binaryData])

      const buffer = await fileToBuffer(blob)

      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString()).toBe('Hello')
    })
  })

  describe('parseFileFromFormData', () => {
    it('should extract file from FormData with default field name', async () => {
      const content = 'test file content'
      const file = new File([content], 'test.txt', { type: 'text/plain' })
      const formData = new FormData()
      formData.append('file', file)

      const result = await parseFileFromFormData(formData)

      expect(result).not.toBeNull()
      expect(result!.file).toBeInstanceOf(File)
      expect(result!.file.name).toBe('test.txt')
      expect(result!.buffer).toBeInstanceOf(Buffer)
      expect(result!.buffer.toString()).toBe(content)
    })

    it('should extract file from FormData with custom field name', async () => {
      const content = 'custom field content'
      const file = new File([content], 'custom.txt', { type: 'text/plain' })
      const formData = new FormData()
      formData.append('customField', file)

      const result = await parseFileFromFormData(formData, 'customField')

      expect(result).not.toBeNull()
      expect(result!.file.name).toBe('custom.txt')
      expect(result!.buffer.toString()).toBe(content)
    })

    it('should return null when field does not exist', async () => {
      const formData = new FormData()

      const result = await parseFileFromFormData(formData)

      expect(result).toBeNull()
    })

    it('should return null when field is not a File', async () => {
      const formData = new FormData()
      formData.append('file', 'not a file')

      const result = await parseFileFromFormData(formData)

      expect(result).toBeNull()
    })

    it('should handle multiple files but only return first', async () => {
      const file1 = new File(['content1'], 'file1.txt')
      const file2 = new File(['content2'], 'file2.txt')
      const formData = new FormData()
      formData.append('file', file1)
      formData.append('file', file2)

      const result = await parseFileFromFormData(formData)

      expect(result).not.toBeNull()
      expect(result!.file.name).toBe('file1.txt')
    })
  })
})
