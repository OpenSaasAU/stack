import mime from 'mime-types'

export interface FileValidationOptions {
  /** Maximum file size in bytes */
  maxFileSize?: number
  /** Accepted MIME types (e.g., ['image/jpeg', 'image/png']) */
  acceptedMimeTypes?: string[]
  /** Accepted file extensions (e.g., ['.jpg', '.png']) */
  acceptedExtensions?: string[]
}

export interface FileValidationResult {
  valid: boolean
  error?: string
}

export function validateFile(
  file: { size: number; name: string; type: string },
  options?: FileValidationOptions,
): FileValidationResult {
  if (!options) {
    return { valid: true }
  }

  if (options.maxFileSize && file.size > options.maxFileSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${formatFileSize(options.maxFileSize)}`,
    }
  }

  if (options.acceptedMimeTypes && options.acceptedMimeTypes.length > 0) {
    const fileMimeType = file.type || mime.lookup(file.name) || ''
    if (!options.acceptedMimeTypes.includes(fileMimeType)) {
      return {
        valid: false,
        error: `File type '${fileMimeType}' is not allowed. Accepted types: ${options.acceptedMimeTypes.join(', ')}`,
      }
    }
  }

  if (options.acceptedExtensions && options.acceptedExtensions.length > 0) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!options.acceptedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `File extension '${ext}' is not allowed. Accepted extensions: ${options.acceptedExtensions.join(', ')}`,
      }
    }
  }

  return { valid: true }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
}

export function getMimeType(filename: string): string {
  return mime.lookup(filename) || 'application/octet-stream'
}

export interface FileInfo {
  name: string
  size: number
  type: string
  lastModified?: number
}

export async function fileToBuffer(file: Blob | File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/** Utility for developers to use in their own upload routes. */
export async function parseFileFromFormData(
  formData: FormData,
  fieldName: string = 'file',
): Promise<{ file: File; buffer: Buffer } | null> {
  const file = formData.get(fieldName)

  if (!file || !(file instanceof File)) {
    return null
  }

  const buffer = await fileToBuffer(file)

  return { file, buffer }
}
