import mime from 'mime-types'

/**
 * MIME types that browsers or servers can execute as script or render as
 * active markup. Refused by default (issue #1625) unless a field's own
 * `acceptedMimeTypes` names the exact type — an `.html` upload declared as
 * `application/pdf` must not be stored as `text/html` and served same-origin.
 */
export const ACTIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
])

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

const FILE_VALIDATION_OPTION_KEYS = ['maxFileSize', 'acceptedMimeTypes', 'acceptedExtensions']

/**
 * Checks every member {@link FileValidationOptions} declares, not just the
 * ones a caller happened to set.
 *
 * Every clause below is `key === undefined || <right type>`, which is
 * vacuously true when a key is absent — so this also rejects an unrecognised
 * key (a typo'd `maxFilesize`) and an array, both of which would otherwise
 * satisfy every clause while carrying none of the caller's intent. And
 * `typeof` alone accepts `NaN`, which `validateFile`'s `options.maxFileSize &&
 * …` then treats as falsy and skips — the same silent-disable failure mode
 * reached through a different value.
 */
export function isFileValidationOptions(value: unknown): value is FileValidationOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<Record<keyof FileValidationOptions, unknown>>
  return (
    Object.keys(candidate).every((key) => FILE_VALIDATION_OPTION_KEYS.includes(key)) &&
    (candidate.maxFileSize === undefined || isFiniteNumber(candidate.maxFileSize)) &&
    (candidate.acceptedMimeTypes === undefined ||
      (Array.isArray(candidate.acceptedMimeTypes) &&
        candidate.acceptedMimeTypes.every((entry) => typeof entry === 'string'))) &&
    (candidate.acceptedExtensions === undefined ||
      (Array.isArray(candidate.acceptedExtensions) &&
        candidate.acceptedExtensions.every((entry) => typeof entry === 'string')))
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The bare MIME type, with any `; charset=...`-style parameters and
 * surrounding whitespace stripped, lowercased. A declared `type` of
 * `text/html; charset=utf-8` must still be caught by the active-type set and
 * the accept-list, both of which compare against the bare essence — checking
 * the raw string let a parameterized active type slip past both, while
 * `mime.extension` (used for the stored extension) already strips parameters
 * internally, so the file would still land on disk as `.html`.
 */
function mimeEssence(type: string): string {
  const semicolon = type.indexOf(';')
  const essence = semicolon === -1 ? type : type.slice(0, semicolon)
  return essence.trim().toLowerCase()
}

/**
 * The MIME type an upload is validated and stored under: the client's
 * declared `type` (its bare essence, parameters stripped), or the type
 * looked up from the filename when none is declared. Never the sniffed
 * bytes — that is `image()`'s own job, since only an image has bytes sharp
 * can read back a format from.
 */
export function resolveEffectiveMimeType(file: { name: string; type: string }): string {
  const declared = file.type ? mimeEssence(file.type) : ''
  return declared || getMimeType(file.name)
}

/**
 * The file-size check alone, shared with a caller that must reject an
 * oversized upload before doing any other work on it — `uploadImage` calls
 * this before decoding the buffer with sharp, since a size limit exists
 * precisely to bound the cost of processing an upload at all.
 */
export function checkFileSize(size: number, maxFileSize?: number): FileValidationResult | null {
  if (maxFileSize !== undefined && size > maxFileSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${formatFileSize(maxFileSize)}`,
    }
  }
  return null
}

export function validateFile(
  file: { size: number; name: string; type: string },
  options?: FileValidationOptions,
): FileValidationResult {
  const sizeError = checkFileSize(file.size, options?.maxFileSize)
  if (sizeError) return sizeError

  const effectiveType = resolveEffectiveMimeType(file)
  const acceptedMimeTypes = options?.acceptedMimeTypes

  if (acceptedMimeTypes && acceptedMimeTypes.length > 0) {
    if (!acceptedMimeTypes.includes(effectiveType)) {
      return {
        valid: false,
        error: `File type '${effectiveType}' is not allowed. Accepted types: ${acceptedMimeTypes.join(', ')}`,
      }
    }
  } else if (ACTIVE_MIME_TYPES.has(effectiveType)) {
    // No accept-list was configured to opt in explicitly, so an active type is
    // refused even for a field with no `validation` at all (issue #1625).
    return {
      valid: false,
      error: `File type '${effectiveType}' is active content (can execute as script or markup) and is refused by default. Add it to acceptedMimeTypes to allow it explicitly.`,
    }
  }

  if (options?.acceptedExtensions && options.acceptedExtensions.length > 0) {
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

/**
 * The extension a MIME type is stored under (with leading dot), reversing
 * {@link getMimeType}. Never the client's own extension — the stored name
 * must reflect the validated type, not what the upload was named.
 */
export function extensionForMimeType(mimeType: string): string | undefined {
  const ext = mime.extension(mimeType)
  return ext ? `.${ext}` : undefined
}

/**
 * Renames an upload to the extension its effective MIME type owns, keeping
 * the client's base name for readability. The stored name is never derived
 * from the client's own extension (issue #1625) — an `x.html` declared as
 * `application/pdf` is renamed to `x.pdf`, and a type with no known
 * extension is stored with no extension at all.
 */
export function withEffectiveExtension(originalName: string, effectiveMimeType: string): string {
  const dot = originalName.lastIndexOf('.')
  const base = dot > 0 ? originalName.slice(0, dot) : originalName
  const ext = extensionForMimeType(effectiveMimeType)
  return ext ? `${base}${ext}` : base
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
