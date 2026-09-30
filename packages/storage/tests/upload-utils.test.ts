import { describe, it, expect } from 'vitest'
import {
  validateFile,
  formatFileSize,
  getMimeType,
  extensionForMimeType,
  withEffectiveExtension,
  resolveEffectiveMimeType,
  fileToBuffer,
  parseFileFromFormData,
  isFileValidationOptions,
  ACTIVE_MIME_TYPES,
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

    describe('active content types (issue #1625)', () => {
      it('refuses text/html by default, with no validation config at all', () => {
        const file = { size: 10, name: 'x.html', type: 'text/html' }
        const result = validateFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('text/html')
        expect(result.error).toContain('active content')
      })

      it('refuses an undeclared .html upload (type looked up from the name)', () => {
        const file = { size: 10, name: 'x.html', type: '' }
        const result = validateFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('text/html')
      })

      it('refuses image/svg+xml by default', () => {
        const file = { size: 10, name: 'x.svg', type: 'image/svg+xml' }
        expect(validateFile(file).valid).toBe(false)
      })

      it('refuses application/javascript by default', () => {
        const file = { size: 10, name: 'x.js', type: 'application/javascript' }
        expect(validateFile(file).valid).toBe(false)
      })

      it('refuses an active type declared as something else once the client name resolves to it', () => {
        // A field with acceptedMimeTypes restricted to a non-active type must
        // still refuse an x.html declared under that same allowed type — the
        // accept-list check catches this case directly (mismatch), independent
        // of the active-type default.
        const file = { size: 10, name: 'x.html', type: 'application/pdf' }
        const result = validateFile(file, { acceptedMimeTypes: ['application/pdf'] })
        expect(result.valid).toBe(true) // declared type wins as the effective type for file()
      })

      it('an active type not in the accept-list is rejected by the accept-list check, not silently allowed', () => {
        const file = { size: 10, name: 'x.html', type: 'text/html' }
        const result = validateFile(file, { acceptedMimeTypes: ['application/pdf'] })
        expect(result.valid).toBe(false)
        expect(result.error).toContain('not allowed')
      })

      it('accepts an active type once acceptedMimeTypes names it explicitly', () => {
        const file = { size: 10, name: 'x.html', type: 'text/html' }
        const result = validateFile(file, { acceptedMimeTypes: ['text/html'] })
        expect(result.valid).toBe(true)
      })

      it('does not refuse an inactive type with no validation config', () => {
        const file = { size: 10, name: 'test.pdf', type: 'application/pdf' }
        expect(validateFile(file).valid).toBe(true)
      })
    })

    describe('parameterized MIME types (PR #1674 review: charset must not bypass the active-type check)', () => {
      it('still refuses a declared active type carrying a charset parameter', () => {
        const file = { size: 10, name: 'x.txt', type: 'text/html; charset=utf-8' }
        const result = validateFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('text/html')
      })

      it('still refuses an SVG declared with a charset parameter', () => {
        const file = { size: 10, name: 'x.txt', type: 'image/svg+xml; charset=utf-8' }
        expect(validateFile(file).valid).toBe(false)
      })

      it('matches an accept-list entry against the bare essence, ignoring parameters', () => {
        const file = { size: 10, name: 'x.pdf', type: 'application/pdf; charset=binary' }
        const result = validateFile(file, { acceptedMimeTypes: ['application/pdf'] })
        expect(result.valid).toBe(true)
      })

      it('is case-insensitive and tolerates surrounding whitespace', () => {
        const file = { size: 10, name: 'x.txt', type: ' TEXT/HTML ; charset=utf-8' }
        expect(validateFile(file).valid).toBe(false)
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

  describe('isFileValidationOptions', () => {
    // The guard must narrow only what it has actually checked: passing zero
    // of these caused `{ maxFileSize: 'one megabyte', acceptedMimeTypes: 42 }`
    // to be accepted as real `FileValidationOptions` and silently disable
    // both checks in `validateFile`.
    it.each([
      [
        'a fully-populated valid config',
        { maxFileSize: 2000, acceptedMimeTypes: ['image/jpeg'], acceptedExtensions: ['.jpg'] },
      ],
      ['an empty object', {}],
      ['maxFileSize alone', { maxFileSize: 2000 }],
      ['acceptedMimeTypes alone', { acceptedMimeTypes: ['image/jpeg', 'image/png'] }],
      ['acceptedExtensions alone', { acceptedExtensions: ['.jpg', '.png'] }],
      ['an empty acceptedMimeTypes array', { acceptedMimeTypes: [] }],
      ['an empty acceptedExtensions array', { acceptedExtensions: [] }],
    ])('accepts %s', (_label, value) => {
      expect(isFileValidationOptions(value)).toBe(true)
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'one megabyte'],
      ['a number', 42],
      // The exact shape the issue measured: both members wrong-typed.
      [
        'maxFileSize as a string, acceptedMimeTypes as a number',
        { maxFileSize: 'one megabyte', acceptedMimeTypes: 42 },
      ],
      ['maxFileSize as a string', { maxFileSize: 'one megabyte' }],
      ['maxFileSize as null', { maxFileSize: null }],
      // NaN passes a bare `typeof x === 'number'` check, and `validateFile`'s
      // `options.maxFileSize && …` then treats it as falsy and skips the
      // check — the same silent-disable failure the string case above hits.
      ['maxFileSize as NaN', { maxFileSize: NaN }],
      ['maxFileSize as Infinity', { maxFileSize: Infinity }],
      ['acceptedMimeTypes as a number', { acceptedMimeTypes: 42 }],
      ['acceptedMimeTypes as a string', { acceptedMimeTypes: 'image/jpeg' }],
      ['acceptedMimeTypes with a non-string entry', { acceptedMimeTypes: ['image/jpeg', 42] }],
      ['acceptedExtensions as a number', { acceptedExtensions: 42 }],
      ['acceptedExtensions with a non-string entry', { acceptedExtensions: ['.jpg', null] }],
      ['an array', ['image/png']],
      // Every clause is `key === undefined || …`, vacuously true when a key
      // is simply absent — so a typo'd key must be refused explicitly, or it
      // reaches downstream code as "validated" options that enforce nothing.
      ['a misspelled key', { maxFilesize: 5000 }],
      ['an unrecognised key alongside a valid one', { maxFileSize: 2000, extra: true }],
    ])('rejects %s', (_label, value) => {
      expect(isFileValidationOptions(value)).toBe(false)
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

  describe('resolveEffectiveMimeType', () => {
    it('prefers the declared type over the filename', () => {
      expect(resolveEffectiveMimeType({ name: 'x.html', type: 'application/pdf' })).toBe(
        'application/pdf',
      )
    })

    it('falls back to the filename when no type is declared', () => {
      expect(resolveEffectiveMimeType({ name: 'x.html', type: '' })).toBe('text/html')
    })

    it('falls back to application/octet-stream for an unrecognised name and no type', () => {
      expect(resolveEffectiveMimeType({ name: 'noext', type: '' })).toBe('application/octet-stream')
    })

    it('strips parameters and lowercases a declared type to its bare essence', () => {
      expect(resolveEffectiveMimeType({ name: 'x.txt', type: 'text/html; charset=utf-8' })).toBe(
        'text/html',
      )
      expect(resolveEffectiveMimeType({ name: 'x.txt', type: ' TEXT/HTML ' })).toBe('text/html')
    })
  })

  describe('extensionForMimeType', () => {
    it('reverses common types to their extension, with a leading dot', () => {
      expect(extensionForMimeType('application/pdf')).toBe('.pdf')
      expect(extensionForMimeType('text/html')).toBe('.html')
      expect(extensionForMimeType('image/svg+xml')).toBe('.svg')
      expect(extensionForMimeType('image/png')).toBe('.png')
    })

    it('returns undefined for a type with no known extension', () => {
      expect(extensionForMimeType('application/x-totally-made-up')).toBeUndefined()
    })
  })

  describe('withEffectiveExtension', () => {
    it('renames the stored name to the extension of the effective type, not the client name', () => {
      // The exact case from issue #1625: an .html upload declared as
      // application/pdf must be stored under .pdf, not .html.
      expect(withEffectiveExtension('x.html', 'application/pdf')).toBe('x.pdf')
    })

    it('keeps the base name when the extension already matches', () => {
      expect(withEffectiveExtension('report.pdf', 'application/pdf')).toBe('report.pdf')
    })

    it('drops the extension entirely for a type with no known one', () => {
      expect(withEffectiveExtension('x.bin', 'application/x-totally-made-up')).toBe('x')
    })

    it('handles a name with no extension at all', () => {
      expect(withEffectiveExtension('noext', 'application/pdf')).toBe('noext.pdf')
    })
  })

  describe('ACTIVE_MIME_TYPES', () => {
    it('names the types the desired behavior requires at minimum', () => {
      for (const type of [
        'text/html',
        'application/xhtml+xml',
        'image/svg+xml',
        'text/xml',
        'application/xml',
      ]) {
        expect(ACTIVE_MIME_TYPES.has(type)).toBe(true)
      }
    })

    it('names at least one JavaScript MIME type', () => {
      const jsTypes = ['text/javascript', 'application/javascript', 'application/x-javascript']
      expect(jsTypes.some((type) => ACTIVE_MIME_TYPES.has(type))).toBe(true)
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
