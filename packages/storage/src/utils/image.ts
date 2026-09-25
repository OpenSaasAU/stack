import sharp from 'sharp'
import type {
  ImageTransformationConfig,
  ImageTransformationResult,
  StorageProvider,
} from '../config/types.js'

export async function getImageDimensions(
  buffer: Buffer | Uint8Array,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

/** Sharp decoder names with no `mediaType` of their own in this sharp version. */
const SHARP_FORMAT_MIME_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  heif: 'image/heif',
  jp2: 'image/jp2',
}

export interface DetectedImage {
  width: number
  height: number
  /** The MIME type of the bytes sharp actually decoded, never the client's declared type. */
  mimeType: string
}

/**
 * Sniffs the real format of image bytes, ignoring whatever the client
 * declared. This is `image()`'s own effective-type resolution (issue #1625):
 * a PNG saved with a `.jpg` name and declared `image/jpeg` is still detected
 * and stored as PNG, and bytes sharp cannot decode as an image at all — a
 * non-image `x.png`, a corrupt file — resolve to `null` rather than trusting
 * the declared type.
 */
export async function detectImage(buffer: Buffer | Uint8Array): Promise<DetectedImage | null> {
  try {
    const metadata = await sharp(buffer).metadata()
    const mimeType = metadata.mediaType ?? SHARP_FORMAT_MIME_TYPES[metadata.format]
    if (!mimeType) return null
    return { width: metadata.width || 0, height: metadata.height || 0, mimeType }
  } catch {
    return null
  }
}

export async function transformImage(
  buffer: Buffer | Uint8Array,
  transformation: ImageTransformationConfig,
): Promise<Buffer> {
  let image = sharp(buffer)

  if (transformation.width || transformation.height) {
    image = image.resize({
      width: transformation.width,
      height: transformation.height,
      fit: transformation.fit || 'cover',
    })
  }

  if (transformation.format) {
    const options = {
      quality: transformation.quality || 80,
    }

    switch (transformation.format) {
      case 'jpeg':
        image = image.jpeg(options)
        break
      case 'png':
        image = image.png(options)
        break
      case 'webp':
        image = image.webp(options)
        break
      case 'avif':
        image = image.avif(options)
        break
    }
  }

  return await image.toBuffer()
}

export async function processImageTransformations(
  buffer: Buffer | Uint8Array,
  originalFilename: string,
  transformations: Record<string, ImageTransformationConfig>,
  storageProvider: StorageProvider,
  contentType: string,
): Promise<Record<string, ImageTransformationResult>> {
  const results: Record<string, ImageTransformationResult> = {}

  for (const [name, config] of Object.entries(transformations)) {
    const transformedBuffer = await transformImage(buffer, config)

    const { width, height } = await getImageDimensions(transformedBuffer)

    const ext = config.format ? `.${config.format}` : ''
    const transformedFilename = `${originalFilename}-${name}${ext}`

    const uploadResult = await storageProvider.upload(transformedBuffer, transformedFilename, {
      contentType:
        config.format === 'jpeg'
          ? 'image/jpeg'
          : config.format === 'png'
            ? 'image/png'
            : config.format === 'webp'
              ? 'image/webp'
              : config.format === 'avif'
                ? 'image/avif'
                : contentType,
    })

    results[name] = {
      url: uploadResult.url,
      width,
      height,
      size: uploadResult.size,
    }
  }

  return results
}
